const std = @import("std");

const c = @cImport({
    @cInclude("node_api.h");
});

export fn napi_register_module_v1(env: c.napi_env, exports: c.napi_value) c.napi_value {
    var function: c.napi_value = undefined;
    if (c.napi_create_function(env, null, 0, unpackTarball, null, &function) != c.napi_ok) {
        _ = c.napi_throw_error(env, null, "Failed to create function");
        return null;
    }

    if (c.napi_set_named_property(env, exports, "unpackTarball", function) != c.napi_ok) {
        _ = c.napi_throw_error(env, null, "Failed to add function to exports");
        return null;
    }

    return exports;
}

const Error = error{NapiError};

fn check(status: c.napi_status) !void {
    if (status != c.napi_ok) {
        return error.NapiError;
    }
}

fn get_string(env: c.napi_env, value: c.napi_value, allocator: std.mem.Allocator) ![]u8 {
    var str_len: usize = undefined;
    try check(c.napi_get_value_string_utf8(env, value, null, 0, &str_len));

    const str = try allocator.alloc(u8, str_len + 1);

    try check(c.napi_get_value_string_utf8(env, value, @as([*c]u8, @ptrCast(str)), str.len, &str_len));

    return str[0..str_len];
}

fn strip_components(path: []const u8, count: u32) []const u8 {
    var i: usize = 0;
    var cnt = count;
    while (cnt > 0) : (cnt -= 1) {
        if (std.mem.indexOfScalarPos(u8, path, i, '/')) |pos| {
            i = pos + 1;
        } else {
            i = path.len;
            break;
        }
    }
    return path[i..];
}

fn create_dir_and_file(dir: std.fs.Dir, file_name: []const u8, is_executable: bool) !std.fs.File {
    var mode: std.fs.File.Mode = std.fs.File.default_mode;
    if (std.fs.has_executable_bit and is_executable) {
        mode = 0o755;
    }

    const fs_file = dir.createFile(file_name, .{ .exclusive = true, .mode = mode }) catch |err| {
        if (err == error.FileNotFound) {
            if (std.fs.path.dirname(file_name)) |dir_name| {
                try dir.makePath(dir_name);
                return try dir.createFile(file_name, .{ .exclusive = true, .mode = mode });
            }
        }
        return err;
    };
    return fs_file;
}

fn create_string(env: c.napi_env, allocator: std.mem.Allocator, str: []const u8) !c.napi_value {
    var result: c.napi_value = undefined;

    const c_str = try allocator.dupeZ(u8, str);

    try check(c.napi_create_string_utf8(env, c_str, str.len, &result));

    return result;
}

fn create_number(env: c.napi_env, val: usize) !c.napi_value {
    var result: c.napi_value = undefined;

    try check(c.napi_create_int64(env, @intCast(val), &result));

    return result;
}

fn unpack_tarball_impl(env: c.napi_env, info: c.napi_callback_info) !c.napi_value {
    const allocator = std.heap.c_allocator;

    var result: c.napi_value = undefined;

    var argc: usize = 2;
    var argv: [2]c.napi_value = undefined;

    try check(c.napi_get_cb_info(env, info, &argc, &argv, null, null));

    const dest_path = try get_string(env, argv[0], allocator);
    defer allocator.free(dest_path[0 .. dest_path.len + 1]);

    var c_tar_buf_len: usize = undefined;
    var c_tar_buf: [*]u8 = undefined;
    try check(c.napi_get_buffer_info(env, argv[1], @ptrCast(&c_tar_buf), &c_tar_buf_len));

    const tar_buf: []const u8 = c_tar_buf[0..c_tar_buf_len];

    var tar_buf_reader = std.io.fixedBufferStream(tar_buf);

    const in_stream = tar_buf_reader.reader();

    std.fs.cwd().makePath(dest_path) catch {};
    const out_dir = try std.fs.cwd().openDir(dest_path, .{});

    // std.debug.print("Dest path: {s}\n", .{dest_path});
    // var decompress = std.compress.gzip.decompressor(in_stream);

    var file_name_buffer: [std.fs.max_path_bytes]u8 = undefined;
    var link_name_buffer: [std.fs.max_path_bytes]u8 = undefined;
    var iter = std.tar.iterator(in_stream, .{
        .file_name_buffer = &file_name_buffer,
        .link_name_buffer = &link_name_buffer,
    });

    try check(c.napi_create_array(env, &result));
    const location_key = try create_string(env, allocator, "location");
    const mode_key = try create_string(env, allocator, "mode");
    var idx: u32 = 0;

    while (try iter.next()) |file| {
        const entry_name = strip_components(file.name, 1);
        const is_executable = file.mode & 0o100 != 0;
        if (entry_name.len == 0) {
            continue;
        }
        var should_add: bool = false;

        switch (file.kind) {
            .file => {
                // std.debug.print("Entry: {s}\n", .{entry_name});
                if (create_dir_and_file(out_dir, entry_name, is_executable)) |fs_file| {
                    defer fs_file.close();
                    try file.writeAll(fs_file);
                    should_add = true;
                } else |err| {
                    if (err == error.PathAlreadyExists) {
                        continue;
                    } else {
                        return err;
                    }
                }
            },
            else => {
                continue;
            },
        }

        if (should_add) {
            var el: c.napi_value = undefined;

            try check(c.napi_create_object(env, &el));

            const entry_name_js = try create_string(env, allocator, entry_name);
            const entry_mode_js = try create_number(env, if (is_executable) 0o755 else 0o664);
            try check(c.napi_set_property(env, el, location_key, entry_name_js));
            try check(c.napi_set_property(env, el, mode_key, entry_mode_js));

            try check(c.napi_set_element(env, result, idx, el));
            idx += 1;
        }
    }

    // std.debug.print("Array list: {s}, len: {d}\n", .{ std.json.fmt(entries.items, .{}), entries.items.len });

    return result;
}

fn unpackTarball(env: c.napi_env, info: c.napi_callback_info) callconv(.C) c.napi_value {
    return unpack_tarball_impl(env, info) catch {
        @panic("panic");
        // const msg = @as([*c]const u8, @ptrCast(@errorName(err)));
        // _ = c.napi_throw_error(env, null, msg);

        // return null;
    };
}
