import { WasmModule, FileLocator, WasmModuleFactory } from '@litertjs/wasm-utils';

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
 * An object that can be deleted.
 */
declare interface Deletable {
    delete(): void;
}
/**
 * A C++ vector of elements.
 */
declare interface EmscriptenVector<T> extends Deletable {
    size(): number;
    get(index: number): T & Deletable;
    push_back(item: T): void;
}
declare const emscriptenVectorInt32Brand: unique symbol;
/**
 * A C++ vector of int32_t.
 */
declare interface EmscriptenVectorInt32 extends EmscriptenVector<number> {
    [emscriptenVectorInt32Brand]: void;
}
/**
 * A C++ vector of int32_t.
 */
declare interface EmscriptenVectorInt32Constructor {
    new (): EmscriptenVectorInt32;
}
declare const liteRtEnvironmentBrand: unique symbol;
/**
 * The constructor for the C++ litert::Environment class in Wasm.
 */
declare interface LiteRtEnvironmentConstructor {
    new (...args: never[]): LiteRtEnvironment;
    create(webGpuDevice: GPUDevice | null): LiteRtEnvironment;
}
/**
 * A C++ litert::Environment in Wasm.
 */
declare interface LiteRtEnvironment extends Deletable {
    [liteRtEnvironmentBrand]: void;
}
/**
 * Options for configuring the WebGPU delegate.
 */
declare interface LiteRtGpuOptions {
    precision?: 'fp16' | 'fp32';
}
/**
 * Options for configuring the WebNN delegate.
 */
declare interface LiteRtWebNNOptions {
    devicePreference?: 'cpu' | 'gpu' | 'npu';
    powerPreference?: 'default' | 'high-performance' | 'low-power';
    precision?: 'fp32' | 'fp16';
}
/**
 * Options for loading and compiling a LiteRt model.
 */
declare interface LiteRtCompileOptions {
    accelerator?: 'wasm' | 'webgpu' | 'webnn' | Array<'wasm' | 'webgpu' | 'webnn'>;
    gpuOptions?: LiteRtGpuOptions;
    webNNOptions?: LiteRtWebNNOptions;
}
declare const liteRtModelBrand: unique symbol;
/**
 * The constructor for the C++ litert::Layout class in Wasm.
 */
declare interface LiteRtLayoutConstructor {
    new (...args: never[]): LiteRtLayout;
    create(dimensions: EmscriptenVector<number>): LiteRtLayout;
}
/**
 * A C++ litert::Layout in Wasm.
 */
declare interface LiteRtLayout extends Deletable {
    rank(): number;
    dimensions(): EmscriptenVector<number>;
    hasStrides(): boolean;
    strides(): EmscriptenVector<number>;
    numElements(): number;
}
/**
 * The constructor for the C++ litert::RankedTensorType class in Wasm.
 */
declare interface LiteRtRankedTensorTypeConstructor {
    new (...args: never[]): LiteRtRankedTensorType;
    create(elementType: EmscriptenEnumElement<ElementType>, layout: LiteRtLayout): LiteRtRankedTensorType;
}
/**
 * A C++ litert::RankedTensorType in Wasm.
 */
declare interface LiteRtRankedTensorType extends Deletable {
    elementType(): EmscriptenEnumElement<ElementType>;
    layout(): LiteRtLayout;
    bytes(): number;
}
/**
 * A C++ litert::Model in Wasm.
 */
declare interface LiteRtModel extends Deletable {
    [liteRtModelBrand]: void;
    getNumSignatures(): number;
    getSignature(signatureIndex: number): LiteRtSimpleSignature;
    getInputTensorType(signatureIndex: number, inputIndex: number): LiteRtRankedTensorType;
    getOutputTensorType(signatureIndex: number, outputIndex: number): LiteRtRankedTensorType;
}
/**
 * A C++ litert::SimpleSignature in Wasm.
 */
declare interface LiteRtSimpleSignature extends Deletable {
    key(): string;
    inputNames(): EmscriptenVector<string>;
    outputNames(): EmscriptenVector<string>;
}
/**
 * A C++ litert::TensorBufferRequirements in Wasm.
 */
declare interface LiteRtTensorBufferRequirements extends Deletable {
    supportedTypes(): EmscriptenVector<LiteRtTensorBufferType>;
}
declare const liteRtCompiledModelBrand: unique symbol;
/**
 * A C++ litert::CompiledModel in Wasm.
 */
declare interface LiteRtCompiledModel extends Deletable {
    [liteRtCompiledModelBrand]: void;
    getInputBufferRequirements(signatureIndex: number, inputIndex: number): LiteRtTensorBufferRequirements;
    getOutputBufferRequirements(signatureIndex: number, outputIndex: number): LiteRtTensorBufferRequirements;
    run(signatureIndex: number, inputTensors: LiteRtTensorBuffer[]): LiteRtTensorBuffer[] | Promise<LiteRtTensorBuffer[]>;
    isFullyAccelerated(): boolean;
}
/**
 * ElementType enum representing the types of elements in tensors.
 * Values must match litert::ElementType in
 * litert_model_types.h
 *
 * It is reproduced separately here so it can be used in JS before the Wasm
 * module loads and for typechecking.
 */
declare const ElementType: {
    readonly NONE: 0;
    readonly FLOAT32: 1;
    readonly INT32: 2;
    readonly UINT8: 3;
    readonly INT64: 4;
    readonly STRING: 5;
    readonly BOOL: 6;
    readonly INT16: 7;
    readonly COMPLEX64: 8;
    readonly INT8: 9;
    readonly FLOAT16: 10;
    readonly FLOAT64: 11;
    readonly COMPLEX128: 12;
    readonly UINT64: 13;
    readonly RESOURCE: 14;
    readonly VARIANT: 15;
    readonly UINT32: 16;
    readonly UINT16: 17;
    readonly INT4: 18;
    readonly BFLOAT16: 19;
};
/**
 * The type for possible values of a C++ litert::ElementType.
 */
type ElementType = (typeof ElementType)[keyof typeof ElementType];
/**
 * A C++ enum value in Wasm.
 */
declare interface EmscriptenEnumElement<T> {
    value: T;
}
type EmscriptenEnum<T extends object> = {
    [K in keyof T]: EmscriptenEnumElement<T[K]>;
};
/**
 * A C++ litert::TensorBufferType enum value.
 *
 * This is reproduced separately here so it can be used in JS before the Wasm
 * module loads and for typechecking (i.e., in tensor.copyTo).
 */
declare const TensorBufferType: {
    readonly HOST_MEMORY: 1;
    readonly WEB_GPU_BUFFER: 20;
    readonly WEB_GPU_BUFFER_FP16: 21;
    readonly WEB_GPU_BUFFER_PACKED: 26;
};
/**
 * The type for possible values of a C++ litert::TensorBufferType.
 */
type TensorBufferType = (typeof TensorBufferType)[keyof typeof TensorBufferType];
/**
 * The C++ litert::TensorBufferType enum, containing its values.
 */
type LiteRtTensorBufferTypeEnum = EmscriptenEnum<typeof TensorBufferType>;
/**
 * The type for possible values of a C++ litert::TensorBufferType.
 */
type LiteRtTensorBufferType = LiteRtTensorBufferTypeEnum[keyof LiteRtTensorBufferTypeEnum];
/**
 * A C++ litert::TensorBufferLockMode enum value.
 */
declare interface LiteRtTensorBufferLockModeEnum {
    READ: EmscriptenEnumElement<0>;
    WRITE: EmscriptenEnumElement<1>;
    READ_WRITE: EmscriptenEnumElement<2>;
}
/**
 * The type for possible values of a C++ litert::TensorBufferLockMode.
 */
type LiteRtTensorBufferLockMode = LiteRtTensorBufferLockModeEnum[keyof LiteRtTensorBufferLockModeEnum];
/**
 * The constructor for the C++ litert::TensorBuffer class in Wasm.
 */
declare interface LiteRtTensorBufferConstructor {
    /**
     * Do not use this constructor. It is only here to allow checking
     * `instanceof LiteRtTensorBuffer` in TS. Use `createManaged` instead.
     */
    new (...args: never[]): LiteRtTensorBuffer;
    createManaged(environment: LiteRtEnvironment, bufferType: LiteRtTensorBufferType, tensorType: LiteRtRankedTensorType, bufferSize: number): LiteRtTensorBuffer;
    createFromWebGpuBuffer(environment: LiteRtEnvironment, rankedTensorType: LiteRtRankedTensorType, tensorBufferType: LiteRtTensorBufferType, webGpuBufferPtr: number, /* use wasm.WebGPU.importJsBuffer() */ size: number): LiteRtTensorBuffer;
}
/**
 * An instance of the C++ litert::TensorBuffer class in Wasm.
 */
declare interface LiteRtTensorBuffer extends Deletable {
    lock(mode: LiteRtTensorBufferLockMode): number;
    unlock(): void;
    bufferType(): LiteRtTensorBufferType;
    tensorType(): LiteRtRankedTensorType;
    isWebGpuMemory(): boolean;
    getWebGpuBuffer(): number;
    size(): number;
    packedSize(): number;
    offset(): number;
}
/**
 * Interface for the C++ LiteRt bindings.
 */
declare interface LiteRtWasm extends WasmModule {
    setupLogging(): void;
    LiteRtEnvironment: LiteRtEnvironmentConstructor;
    loadModel(environment: LiteRtEnvironment, modelDataPtr: number, modelSize: number): LiteRtModel;
    compileModel(environment: LiteRtEnvironment, model: LiteRtModel, options?: LiteRtCompileOptions): LiteRtCompiledModel | Promise<LiteRtCompiledModel>;
    wgpuBufferRelease(bufferPtr: number): void;
    LiteRtTensorBuffer: LiteRtTensorBufferConstructor;
    LiteRtTensorBufferType: LiteRtTensorBufferTypeEnum;
    LiteRtTensorBufferLockMode: LiteRtTensorBufferLockModeEnum;
    LiteRtLayout: LiteRtLayoutConstructor;
    LiteRtRankedTensorType: LiteRtRankedTensorTypeConstructor;
    VectorInt32: EmscriptenVectorInt32Constructor;
    liteRtGetByteWidth(elementType: EmscriptenEnumElement<ElementType>): number;
    WebGPU: WasmWebGpuObjectInterface;
    checkTensorBufferCompatible(tensorBuffer: LiteRtTensorBuffer, expectedRankedTensorType: LiteRtRankedTensorType, requirements: LiteRtTensorBufferRequirements): void;
    getThreadCount(): number;
}
/**
 * Interface for sharing WebGPU objects between WASM and the JS side.
 */
declare interface WasmWebGpuObjectInterface {
    getJsObject(id: number): GPUBuffer;
    importJsBuffer(buffer: GPUBuffer): number;
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

/**
 * Represents a loaded LiteRt model.
 */
declare class Model implements Deletable {
    readonly liteRtModel: LiteRtModel;
    private readonly onDelete;
    constructor(liteRtModel: LiteRtModel, onDelete: () => void);
    delete(): void;
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

/**
 * Options for creating a LiteRT.js Environment.
 *
 * If a property is omitted, it may be set to a default value. If a property is
 * explicitly set to `null`, no default value will be used.
 */
interface EnvironmentOptions {
    webGpuDevice?: GPUDevice | null;
}
/**
 * A type that has an environment property.
 */
interface WithEnvironment {
    readonly environment: Environment;
}
/**
 * An environment for LiteRT.js.
 */
declare class Environment implements Deletable, EnvironmentOptions {
    readonly options: Required<EnvironmentOptions>;
    readonly liteRtEnvironment: LiteRtEnvironment;
    constructor(options: Required<EnvironmentOptions>);
    static create(options?: EnvironmentOptions): Promise<Environment>;
    get webGpuDevice(): GPUDevice | null;
    delete(): void;
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
/**
 * The accelerators that LiteRt Web supports.
 */
declare const ACCELERATORS: readonly ["webgpu", "wasm"];
/**
 * The type for accelerators that LiteRt Web supports.
 */
type Accelerator = (typeof ACCELERATORS)[number];

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
 * An array of objects for matching datatype strings, TypedArray constructors,
 * and LiteRT element types.
 *
 * The TypedArray constructor is not guaranteed to be unique across these values
 * since JavaScript does not have as many TypedArray types as LiteRT has
 * element types.
 */
declare const DATATYPES: readonly [{
    readonly dtype: "float32";
    readonly typedArrayConstructor: Float32ArrayConstructor;
    readonly elementType: 1;
}, {
    readonly dtype: "int32";
    readonly typedArrayConstructor: Int32ArrayConstructor;
    readonly elementType: 2;
}, {
    readonly dtype: "uint8";
    readonly typedArrayConstructor: Uint8ArrayConstructor;
    readonly elementType: 3;
}];
/**
 * Defines how a given datatype is mapped to a string, TypedArray constructor,
 * and LiteRT element type.
 */
type DataTypeMapping = (typeof DATATYPES)[number];
/**
 * The data type of a Tensor.
 */
type DType = DataTypeMapping['dtype'];
/**
 * The constructor for a TypedArray.
 */
type TypedArrayConstructor = DataTypeMapping['typedArrayConstructor'];
/**
 * A TypedArray.
 */
type TypedArray = InstanceType<TypedArrayConstructor>;
declare global {
    interface Int32ArrayConstructor {
        new (buffer: ArrayBuffer, byteOffset?: number, length?: number): Int32Array;
    }
    interface Float32ArrayConstructor {
        new (buffer: ArrayBuffer, byteOffset?: number, length?: number): Float32Array;
    }
}

/**
 * g3-format-prettier
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
 * Options for copying a Tensor to another accelerator or buffer type.
 */
interface CopyOptions {
    environment?: Environment;
}
/**
 * A function that copies a Tensor to another accelerator or buffer type.
 *
 * @param tensor The tensor to copy.
 * @param options Options for the copy operation.
 * @return A promise that resolves to the copied tensor.
 */
type TensorCopyFn = (tensor: Tensor, options?: CopyOptions) => Tensor | Promise<Tensor>;
/**
 * A set of copy functions for copying tensors between accelerators.
 */
interface CopyFunctionSet {
    moveTo?: TensorCopyFn;
    copyTo?: TensorCopyFn;
}
/**
 * A map of copy functions for copying tensors between accelerators.
 *
 * The first key is the source buffer type. The second key is the destination
 * buffer type.
 */
type TensorCopyFunctions = Map<TensorBufferType, Map<TensorBufferType, CopyFunctionSet>>;
/**
 * The dimensions or shape of a Tensor.
 */
type Dimensions = Int32Array | number[];
/**
 * Metadata about a Tensor including its type and layout.
 *
 * This type only includes information about the tensor itself, not the
 * accelerator it is on.
 */
interface TensorType {
    dtype: DType;
    layout: {
        dimensions: Dimensions;
    };
}
/**
 * A tensor that is passed to or from a model.
 */
declare class Tensor implements Deletable, WithEnvironment {
    readonly liteRtTensorBuffer: LiteRtTensorBuffer;
    readonly type: TensorType;
    readonly environment: Environment;
    private deletedInternal;
    private onDelete;
    static copyFunctions: TensorCopyFunctions;
    constructor(data: TypedArray, shape?: Dimensions, environment?: Environment, onDelete?: () => void);
    constructor(liteRtTensorBuffer: LiteRtTensorBuffer, environment?: Environment, onDelete?: () => void);
    constructor(gpuBuffer: GPUBuffer, shape: Dimensions, dataType: DType, environment?: Environment, onDelete?: () => void);
    static fromTypedArray(data: TypedArray, shape?: Dimensions, environment?: Environment): Tensor;
    private ensureNotDeleted;
    data(): Promise<TypedArray>;
    toTypedArray(): TypedArray;
    getBufferType(): TensorBufferType;
    /**
     * Returns the underlying GPUBuffer of the Tensor.
     *
     * Note that the lifetime of the returned GPUBuffer is dependant upon how the
     * Tensor was created. If the Tensor was constructed from a GPUBuffer, then
     * the GPUBuffer will NOT be released when the Tensor is deleted. If the
     * Tensor was copied/moved to GPU from host memory, then the GPU buffer will
     * be released when the Tensor is deleted.
     *
     * The GPU buffer may be larger than the actual data in the tensor.
     *
     * @return The GPUBuffer containing the Tensor's data.
     */
    toGpuBuffer(): GPUBuffer;
    private getCopyFunctionSet;
    /**
     * Copies the tensor to the given accelerator.
     *
     * @param destination The accelerator or buffer type to copy to.
     * @return A promise that resolves to the copied tensor.
     */
    copyTo(destination: Accelerator | TensorBufferType, options?: CopyOptions): Promise<Tensor>;
    /**
     * Moves the tensor to the given accelerator.
     *
     * @param destination The accelerator or buffer type to move to.
     * @return A promise that resolves to the moved tensor.
     */
    moveTo(destination: Accelerator | TensorBufferType, options?: CopyOptions): Promise<Tensor>;
    get bufferType(): TensorBufferType;
    get accelerator(): Accelerator;
    get deleted(): boolean;
    delete(): void;
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

/**
 * Options for compiling a LiteRt model on CPU.
 */
interface CpuOptions {
    numThreads?: number;
}
/**
 * Options for loading and compiling a LiteRt model.
 */
interface CompileOptions extends LiteRtCompileOptions {
    environment?: Environment;
    cpuOptions?: CpuOptions;
    gpuOptions?: LiteRtGpuOptions;
    webNNOptions?: LiteRtWebNNOptions;
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

/**
 * Description of a tensor in a LiteRT model.
 */
interface TensorDetails {
    readonly name: string;
    readonly index: number;
    readonly dtype: DType;
    readonly shape: Int32Array;
    readonly supportedBufferTypes: ReadonlySet<TensorBufferType>;
}
/**
 * A signature of a LiteRT model that can be run like the CompiledModel itself.
 * Every model has at least one signature, but some models have multiple
 * signatures.
 */
interface SignatureRunner {
    readonly key: string;
    readonly options: Required<CompileOptions>;
    getInputDetails(): readonly TensorDetails[];
    getOutputDetails(): readonly TensorDetails[];
    run(input: Tensor | Tensor[]): Promise<Tensor[]>;
    run(input: Record<string, Tensor>): Promise<Record<string, Tensor>>;
    run(input: Tensor | Tensor[] | Record<string, Tensor>): Promise<Tensor[] | Record<string, Tensor>>;
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

/**
 * Represents a compiled LiteRt model.
 */
declare class CompiledModel implements Deletable, SignatureRunner {
    private readonly model;
    private readonly liteRtCompiledModel;
    readonly options: Required<CompileOptions>;
    private readonly onDelete;
    private readonly defaultSignature;
    private readonly compiledModelSignatureRunners;
    readonly key: string;
    private deletedInternal;
    constructor(model: Model, liteRtCompiledModel: LiteRtCompiledModel, options: Required<CompileOptions>, onDelete: () => void);
    get signatures(): Record<string, SignatureRunner>;
    getInputDetails(): readonly TensorDetails[];
    getOutputDetails(): readonly TensorDetails[];
    /**
     * Runs the default signature with positional input tensors.
     * @param input The input tensors.
     * @return A promise that resolves to the output tensors.
     */
    run(input: Tensor | Tensor[]): Promise<Tensor[]>;
    /**
     * Runs the default signature with named input tensors.
     * @param input A record of named input tensors.
     * @return A promise that resolves to a record of named output tensors.
     */
    run(input: Record<string, Tensor>): Promise<Record<string, Tensor>>;
    /**
     * Runs a specific signature by name with positional input tensors.
     * @param signatureName The name of the signature to run.
     * @param input The input tensors.
     * @return A promise that resolves to the output tensors.
     */
    run(signatureName: string, input: Tensor | Tensor[]): Promise<Tensor[]>;
    /**
     * Runs a specific signature by name with named input tensors.
     * @param signatureName The name of the signature to run.
     * @param input A record of named input tensors.
     * @return A promise that resolves to a record of named output tensors.
     */
    run(signatureName: string, input: Record<string, Tensor>): Promise<Record<string, Tensor>>;
    run(input: Tensor | Tensor[] | Record<string, Tensor>): Promise<Tensor[] | Record<string, Tensor>>;
    run(signatureName: string, input: Tensor | Tensor[] | Record<string, Tensor>): Promise<Tensor[] | Record<string, Tensor>>;
    private parseRunInputs;
    get deleted(): boolean;
    private ensureNotDeleted;
    get isFullyAccelerated(): boolean;
    delete(): void;
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

/**
 * Check if the browser supports WebGPU.
 */
declare function isWebGPUSupported(): boolean;
/**
 * Get or create the default environment.
 */
declare function getDefaultEnvironment(): Environment;
/**
 * Loads and compiles a LiteRt model.
 *
 * @param model The model data. This can be a string (the model url), a URL
 *     object, a Uint8Array (the model bytes), or a
 *     ReadableStreamDefaultReader (for streaming model loading).
 * @param compileOptions The options for compiling the model. This includes
 *     the accelerator to use ('webgpu' or 'wasm') and the WebGPU device
 *     (for direct GPU model inputs / outputs).
 * @return A promise that resolves to the CompiledModel.
 */
declare function loadAndCompile(model: string | URL | Uint8Array | ReadableStreamDefaultReader, compileOptions?: CompileOptions): Promise<CompiledModel>;
/**
 * Get the WebGPU device used by the default environment.
 */
declare function getWebGpuDevice(): GPUDevice | null;
/**
 * Create a new default environment with the given WebGPU device.
 */
declare function setWebGpuDevice(device: GPUDevice): void;
/**
 * Run LiteRt models in the browser.
 */
declare class LiteRt {
    readonly liteRtWasm: LiteRtWasm;
    private defaultEnvironment?;
    private readonly objectsToDelete;
    constructor(wasmModule: WasmModule);
    setDefaultEnvironment(environment: Environment): void;
    getDefaultEnvironment(): Environment;
    setWebGpuDevice(device: GPUDevice): void;
    getWebGpuDevice(): GPUDevice | null;
    /**
     * Loads and compiles a LiteRt model.
     *
     * @param model The model data. This can be a string (the model url), a URL
     *     object, a Uint8Array (the model bytes), or a
     *     ReadableStreamDefaultReader (for streaming model loading).
     * @param compileOptions The options for compiling the model. This includes
     *     the accelerator to use ('webgpu' or 'wasm') and the WebGPU device
     *     (for direct GPU model inputs / outputs).
     * @returns A promise that resolves to the CompiledModel.
     */
    loadAndCompile(model: string | URL | Uint8Array | ReadableStreamDefaultReader<Uint8Array>, compileOptions?: CompileOptions): Promise<CompiledModel>;
    delete(): void;
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

/**
 * An error thrown when LiteRT is not loaded.
 */
declare class LiteRtNotLoadedError extends Error {
    constructor();
}
/**
 * Get the global LiteRT instance.
 *
 * In most cases, you can call the functions exported by this module that wrap
 * the global LiteRT instance instead.
 */
declare function getGlobalLiteRt(): LiteRt;
/**
 * Resolves when the currently loading / loaded LiteRT instance is loaded.
 *
 * If `loadLiteRt()` has been called, this function returns a promise that
 * resolves when the LiteRT instance is loaded. Otherwise, it returns undefined.
 *
 * If LiteRT has failed to load before this function is called or has been
 * manually unloaded with `unloadLiteRt()`, this function also returns
 * undefined.
 */
declare function getGlobalLiteRtPromise(): Promise<LiteRt> | undefined;

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
 * Type for a path to a resource.
 */
type UrlPath = string;

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

type WasmModuleSource = UrlPath | WasmModuleFactory;
type WasmLoaderType = 'script' | 'module';
/**
 * Options for loading LiteRT's Wasm module.
 *
 * @property threads Whether to load the threaded version of the Wasm module.
 *     Defaults to false. Unused when specifying a .js file directly instead of
 *     a directory containing the Wasm files.
 * @property jspi Whether to load the JSPI version of the Wasm module. Defaults
 *     to false. Unused when specifying a .js file directly instead of a
 *     directory containing the Wasm files.
 * @property wasmLoaderType Whether to load Emscripten's generated glue as a
 *     classic script or as an ES module. Defaults to 'script'. When set to
 *     'module' and a directory path is provided, LiteRT.js selects the
 *     corresponding `.mjs` file.
 * @property fileLocator File locator overrides passed to Emscripten's module
 *     factory.
 **/
interface LoadOptions {
    threads?: boolean;
    jspi?: boolean;
    wasmLoaderType?: WasmLoaderType;
    fileLocator?: FileLocator;
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

/**
 * Options for loading LiteRT.
 *
 * @property threads Whether to load the threaded version of the Wasm module.
 *     Defaults to false. Unused when specifying a .js file directly instead of
 *     a directory containing the Wasm files.
 * @property jspi Whether to load the JSPI version of the Wasm module. Defaults
 *     to false. Unused when specifying a .js file directly instead of a
 *     directory containing the Wasm files.
 **/
type LoadLiteRtOptions = LoadOptions;
/**
 * Load LiteRT.js Wasm files from the given URL. This needs to be called before
 * calling any other LiteRT functions.
 *
 * The URL can be:
 *
 * - A directory containing the LiteRT Wasm files (e.g. `.../wasm/`), or
 * - The LiteRT Wasm's js/mjs file (e.g. `.../litert_wasm_internal.js`), or
 * - An Emscripten ES module factory imported from a generated `.mjs` file.
 *
 * If the URL is to a directory, LiteRT.js will detect what WASM features are
 * available in the browser and load the compatible WASM file. If the URL is
 * to a file, it will be loaded as is.
 *
 * @param path The path to the directory containing the LiteRT Wasm files, or
 *     the full URL of the LiteRT Wasm .js/.mjs file. Emscripten ES module
 *     factories can also be passed directly.
 */
declare function loadLiteRt(path: WasmModuleSource, options?: LoadLiteRtOptions): Promise<LiteRt>;
/**
 * Unload the LiteRt WASM module.
 *
 * This deletes the global LiteRT instance and invalidate any models,
 * signatures, and tensors associated with it. You will need to call
 * loadLiteRt() again to reload the module.
 */
declare function unloadLiteRt(): void;

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
interface SupportStatus {
    supported: boolean;
    error?: Error;
}
declare interface WasmFeatureValues {
    relaxedSimd: Promise<SupportStatus> | undefined;
    threads: Promise<SupportStatus> | undefined;
    jspi: Promise<SupportStatus> | undefined;
    webnn: Promise<SupportStatus> | undefined;
}
declare const WASM_FEATURE_VALUES: WasmFeatureValues;
declare const WASM_FEATURE_CHECKS: Record<keyof typeof WASM_FEATURE_VALUES, () => Promise<SupportStatus>>;
/**
 * Check if a given WASM feature is supported.
 *
 * @param feature The feature to check.
 * @return A promise that resolves to true if the feature is supported,
 *     false otherwise.
 */
declare function supportsFeature(feature: keyof typeof WASM_FEATURE_CHECKS): Promise<boolean>;

export { type Accelerator, type CompileOptions, CompiledModel, type CopyOptions, type DType, type Dimensions, Environment, type EnvironmentOptions, LiteRt, LiteRtNotLoadedError, type LoadLiteRtOptions, type SignatureRunner, Tensor, TensorBufferType, type TensorCopyFn, type TensorDetails, type TensorType, type TypedArray, getDefaultEnvironment, getGlobalLiteRt, getGlobalLiteRtPromise, getWebGpuDevice, isWebGPUSupported, loadAndCompile, loadLiteRt, setWebGpuDevice, supportsFeature, unloadLiteRt };
