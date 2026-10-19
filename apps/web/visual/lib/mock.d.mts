import type { Browser } from '@playwright/test';
import type { Rgba } from './pixel-metrics.mjs';
export const MOCK_FILE: string;
export const MOCK_REFS: { tw01: string; yt1: string };
export function renderMock(browser: Browser, pixels: { decode(source: string | { data: Buffer; type?: string }): Promise<Rgba> }, refDir: string, file?: string): Promise<{ img: Rgba; quad: { x: number; y: number }[]; png: Buffer }>;
