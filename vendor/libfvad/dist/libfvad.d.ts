export interface LibFvadModuleFactoryOptions {
  wasmBinary?: Uint8Array;
  print?: (message: string) => void;
  printErr?: (message: string) => void;
}

export interface LibFvadModule {
  HEAP16: Int16Array;
  _malloc(size: number): number;
  _free(ptr: number): void;
  _fvad_new(): number;
  _fvad_free(handle: number): void;
  _fvad_reset(handle: number): void;
  _fvad_set_mode(handle: number, mode: number): number;
  _fvad_set_sample_rate(handle: number, sampleRate: number): number;
  _fvad_process(handle: number, framePtr: number, frameLength: number): number;
}

export default function createLibFvadModule(
  options?: LibFvadModuleFactoryOptions
): Promise<LibFvadModule>;
