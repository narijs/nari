const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});
    const name = "native";

    const lib = b.addSharedLibrary(.{
        .name = name,
        .root_source_file = b.path("src/native/native.zig"),
        .link_libc = true,
        .target = target,
        .optimize = optimize,
    });

    lib.addSystemIncludePath(b.path("node_modules/.cache/napi/include/node"));

    const step = b.addInstallArtifact(lib, .{ .dest_dir = .{ .override = .{ .custom = "lib" } } });
    b.getInstallStep().dependOn(&step.step);
}
