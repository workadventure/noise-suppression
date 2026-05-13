/**
 * Copyright 2025 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/**
 * Declarations for Emscripten's WebAssembly Module behavior, so TS compiler
 * doesn't break our various JS/C++ bridges. For internal usage.
 */
declare interface WasmModule {
    HEAPU8: Uint8Array;
    HEAPU32: Uint32Array;
    HEAPF32: Float32Array;
    HEAPF64: Float64Array;
    _free: (ptr: number) => void;
    _malloc: (size: number) => number;
}

/**
 * Copyright 2025 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

type UrlString = string;
/**
 * Internal type of constructors used for initializing wasm modules.
 */
type WasmConstructor<LibType> = (new (module: WasmModule, canvas?: HTMLCanvasElement | OffscreenCanvas | null) => LibType);
/**
 * Simple interface for allowing users to set the directory where internal
 * wasm-loading and asset-loading code looks (e.g. for .wasm and .data file
 * locations).
 */
declare interface FileLocator {
    locateFile: (filename: string) => string;
    mainScriptUrlOrBlob?: string;
}
/**
 * Factory exported by Emscripten's ES module output.
 */
type WasmModuleFactory = (fileLocator?: FileLocator) => Promise<WasmModule>;
/**
 * Options for initializing a Wasm library.
 */
declare interface CreateWasmLibOptions {
    wasmLoaderScript?: UrlString | null;
    assetLoaderScript?: UrlString | null;
    glCanvas?: HTMLCanvasElement | OffscreenCanvas | null;
    fileLocator?: FileLocator;
    moduleFactory?: WasmModuleFactory;
}
/**
 * Global function interface to initialize Wasm blob and load runtime assets for
 *     a specialized Wasm library. Standard implementation is
 *     `createWasmLib<LibType>`.
 * @param constructorFcn The name of the class to instantiate via "new".
 * @param wasmLoaderScript Url for the wasm-runner script; produced by the build
 *     process.
 * @param assetLoaderScript Url for the asset-loading script; produced by the
 *     build process.
 * @param fileLocator A function to override the file locations for assets
 *     loaded by the Wasm library.
 * @return promise A promise which will resolve when initialization has
 *     completed successfully.
 */
interface CreateWasmLibApi {
    <LibType>(constructorFcn: WasmConstructor<LibType>, options?: CreateWasmLibOptions): Promise<LibType>;
    <LibType>(constructorFcn: WasmConstructor<LibType>, wasmLoaderScript?: UrlString | null, assetLoaderScript?: UrlString | null, glCanvas?: HTMLCanvasElement | OffscreenCanvas | null, fileLocator?: FileLocator): Promise<LibType>;
}
declare global {
    interface Window {
        Module?: WasmModule | FileLocator;
        ModuleFactory?: (fileLocator: FileLocator) => Promise<WasmModule>;
    }
}
/** {@override CreateWasmLibApi} */
declare const createWasmLib: CreateWasmLibApi;

export { type CreateWasmLibApi, type CreateWasmLibOptions, type FileLocator, type WasmConstructor, type WasmModule, type WasmModuleFactory, createWasmLib };
