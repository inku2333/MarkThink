@echo off
REM Activate the repository's portable Rust toolchain in the current cmd window.
REM
REM This machine has no system-wide Rust: everything lives in .toolchain\.
REM The npm scripts inject these variables automatically; this file is only for
REM running cargo/rustc by hand.
REM
REM   call rust-env.cmd      <- keeps the variables in the current window
REM   rust-env.cmd           <- runs in a child process, variables are lost

set "CARGO_HOME=%~dp0.toolchain\cargo"
set "RUSTUP_HOME=%~dp0.toolchain\rustup"
set "PATH=%CARGO_HOME%\bin;%PATH%"

echo CARGO_HOME=%CARGO_HOME%
echo RUSTUP_HOME=%RUSTUP_HOME%
cargo --version
