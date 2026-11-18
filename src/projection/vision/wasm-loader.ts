/**
 * MediaPipe's WASM bootstrap is a classic script. In a module worker its
 * importScripts() call throws and the Tasks runtime delegates to self.import.
 * Wrap that trusted local script as an ES module without eval or package edits.
 */
interface MediaPipeGlobals {
  import?: (url: string) => Promise<void>;
  ModuleFactory?: unknown;
}
export function installMediaPipeModuleLoader(): void {
  const globals = globalThis as unknown as MediaPipeGlobals;
  globals.import = async (url: string): Promise<void> => {
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(`WASM loader could not load (${response.status}).`);
    const source = await response.text();
    const moduleUrl = URL.createObjectURL(
      new Blob(
        [
          "const dbg = (...values) => console.debug(...values);\n",
          source,
          "\nexport default ModuleFactory;\n",
        ],
        { type: "application/javascript" },
      ),
    );
    try {
      const loaded = (await import(/* @vite-ignore */ moduleUrl)) as {
        default: unknown;
      };
      globals.ModuleFactory = loaded.default;
    } finally {
      URL.revokeObjectURL(moduleUrl);
    }
  };
}
