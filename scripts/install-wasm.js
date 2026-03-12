// Compile and copy artifacts for WebAssembly build in a cross platform manner.

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { execSync } = require("child_process");

// eslint-disable-next-line @typescript-eslint/no-var-requires
let { copyFileSync, existsSync } = require("fs");
// eslint-disable-next-line @typescript-eslint/no-var-requires
let { join } = require("path");

// Check if this is an OSX Machine
const isMac = process.platform === "darwin";

let emscriptenInstalled = false;
// Check if emscripten is installed
try {
  execSync("emcc --version");
  emscriptenInstalled = true;
} catch (e) {
  console.log(e);
  console.log("Emscripten is not installed, trying to install it.");
}

if (!emscriptenInstalled && isMac) {
  // Install emscripten with brew
  try {
    execSync("brew install emscripten");
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
} else if (!emscriptenInstalled) {
  // Windows and other OSes.
  console.error("Emscripten is not installed. Please install it manually.");
  process.exit(1);
}

let wasm32_target_installed = false;
// Check if wasm32-unknown-emscripten target is installed
try {
  const output = execSync("rustup target list --installed").toString();

  wasm32_target_installed = output.includes("wasm32-unknown-emscripten");
} catch (e) {
  console.error("Unable to determine if wasm32-unknown-emscripten target is installed.");
  process.exit(1);
}

if (!wasm32_target_installed) {
  // Install wasm32-unknown-emscripten target if necessary
  try {
    execSync("rustup target add wasm32-unknown-emscripten");
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

// Run cargo clean
// eslint-disable-next-line @typescript-eslint/no-var-requires
execSync("cargo clean");

// Run cargo build
try {
  execSync(
    "cargo build --release --message-format=json-render-diagnostics --target wasm32-unknown-emscripten --bin dtln-rs",
    { stdio: "inherit" }
  );
} catch (e) {
  console.error(e);
  process.exit(1);
}

const releaseDir = join(__dirname, "..", "target", "wasm32-unknown-emscripten", "release");
const jsCandidates = ["dtln-rs.js", "dtln_rs.js"];
const wasmCandidates = ["dtln-rs.wasm", "dtln_rs.wasm"];
const jsDest = join(__dirname, "..", "dtln.js");
const wasmDest = join(__dirname, "..", "dtln_rs.wasm");

const js = jsCandidates.map((name) => join(releaseDir, name)).find((file) => existsSync(file));
const wasm = wasmCandidates.map((name) => join(releaseDir, name)).find((file) => existsSync(file));

if (!js) {
  console.error("Unable to find the generated JavaScript artifact in", releaseDir);
  process.exit(1);
}

console.log("Copying artifacts...");
console.log(" " + js + " -> " + jsDest);
if (wasm) {
  console.log(" " + wasm + " -> " + wasmDest);
} else {
  console.log(" No standalone .wasm emitted (SINGLE_FILE build)");
}

try {
  copyFileSync(js, jsDest);
  if (wasm) {
    copyFileSync(wasm, wasmDest);
  }
} catch (err) {
  console.error(err);
  process.exit(1);
}
