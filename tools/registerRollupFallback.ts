import Module from 'node:module';

const isModuleNotFound = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND';

type NodeModuleLoader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;

const moduleLoader = Module as unknown as { _load: NodeModuleLoader };

let patched = false;

export const registerRollupFallback = () => {
  if (patched) {
    return;
  }
  patched = true;

  const originalLoad = moduleLoader._load;

  const patchedLoad: NodeModuleLoader = function patchedRollupLoad(
    this: unknown,
    request: string,
    parent: NodeModule | undefined,
    isMain: boolean,
  ) {
    const target = this ?? moduleLoader;
    if (request.startsWith('@rollup/rollup-')) {
      try {
        return Reflect.apply(originalLoad, target, [request, parent, isMain]);
      } catch (error) {
        if (isModuleNotFound(error)) {
          return Reflect.apply(originalLoad, target, ['@rollup/wasm-node', parent, isMain]);
        }
        throw error;
      }
    }

    return Reflect.apply(originalLoad, target, [request, parent, isMain]);
  };

  moduleLoader._load = patchedLoad;
};
