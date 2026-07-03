const std = @import("std");

pub fn build(b: *std.Build) void {
    const optimize = b.standardOptimizeOption(.{ .preferred_optimize_mode = .ReleaseFast });
    const wasm_target = b.resolveTargetQuery(.{
        .cpu_arch = .wasm32,
        .os_tag = .freestanding,
    });

    const wasm = b.addExecutable(.{
        .name = "phantom_kernel",
        .root_module = b.createModule(.{
            .root_source_file = b.path("zig/src/phantom-kernel.zig"),
            .target = wasm_target,
            .optimize = optimize,
        }),
    });
    wasm.entry = .disabled;
    wasm.rdynamic = true;
    wasm.export_memory = true;

    const install_wasm = b.addInstallFile(wasm.getEmittedBin(), "phantom_kernel.wasm");
    b.getInstallStep().dependOn(&install_wasm.step);

    const native_tests = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("zig/src/phantom-kernel.zig"),
            .target = b.graph.host,
            .optimize = .Debug,
        }),
    });
    const run_native_tests = b.addRunArtifact(native_tests);
    const test_step = b.step("test", "Run native Zig kernel tests");
    test_step.dependOn(&run_native_tests.step);
}
