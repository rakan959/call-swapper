import { afterEach, describe, expect, it, vi } from 'vitest';

const APP_PATH = '../../src/App';
const MAIN_PATH = '../../src/main';
const REACT_DOM_CLIENT = 'react-dom/client';

describe('main bootstrap', () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('throws when root container is missing', async () => {
    const body = { innerHTML: '' } as Pick<HTMLBodyElement, 'innerHTML'>;
    const getElementById = vi.fn(() => null);
    vi.stubGlobal('document', { body, getElementById } as unknown as Document);

    vi.doMock(APP_PATH, () => ({ default: () => null }));
    const render = vi.fn();
    const createRoot = vi.fn(() => ({ render }));
    vi.doMock(REACT_DOM_CLIENT, () => ({ createRoot }));

    await expect(import(MAIN_PATH)).rejects.toThrowError('Root element #root not found');

    expect(getElementById).toHaveBeenCalledWith('root');
    expect(createRoot).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
  });

  it('mounts the application when root container exists', async () => {
    const body = { innerHTML: '' } as Pick<HTMLBodyElement, 'innerHTML'>;
    const container = { id: 'root' } as unknown as HTMLElement;
    const getElementById = vi.fn(() => container);
    vi.stubGlobal('document', { body, getElementById } as unknown as Document);

    vi.doMock(APP_PATH, () => ({ default: () => null }));
    const render = vi.fn();
    const createRoot = vi.fn(() => ({ render }));
    vi.doMock(REACT_DOM_CLIENT, () => ({ createRoot }));

    await expect(import(MAIN_PATH)).resolves.toBeDefined();

    expect(getElementById).toHaveBeenCalledWith('root');
    expect(createRoot).toHaveBeenCalledTimes(1);
    expect(createRoot).toHaveBeenCalledWith(container);
    expect(render).toHaveBeenCalledTimes(1);
  });
});
