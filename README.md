# nari

[![npm version](https://badge.fury.io/js/nari.svg)](https://badge.fury.io/js/nari)

A lockfile-less JavaScript package manager.

Goals:
  - Developer productivity with existing JavaScript ecosystem and tooling
  - The best performance achievable with Node.js
  - Good explanation of package manager behavior - why the dependency is placed here or there during installation, what factors contributed to this decision and what to do to make the dependency singular for the project
  - Fine-grained control of package manager behavior for various types of workflows
  - Experimental features that has good compatibility with current JavaScript ecosystem

Implemented experimental features:
  - Reproducible installs without "fat" lockfiles. `lockTime` field is used instead in the `package.json` file to fixate the time of install. On subsequent installs the highest dependency versions are picked that were published before `lockTime`. When new dependencies added to the project that were published after `lockTime` their ranges are resolved to the minimal satisfying version (typically the ranges of newly added dependencies are the latest at the moment when they are added to the `package.json`).

## Usage:

1. Install `nari` globally first:
  ```bash
  npm i -g nari
  ```

2. Run installation within your Node.js project directory:
  ```bash
  nari
  ```

3. Run script `foo` from `package.json`:
  ```bash
  nari foo
  ```

4. Add/remove packages to your project:
  ```bash
  nari add lodash
  ```

5. Get command line help:
  ```
  nari -h
  ```
