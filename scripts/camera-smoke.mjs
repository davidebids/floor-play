import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const baseUrl = process.env.PROJECTION_VISION_URL ?? 'http://127.0.0.1:5190';
const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--use-fake-ui-for-media-stream'] });
const context = await browser.newContext({ permissions: ['camera'] });
const page = await context.newPage();
const report = { date: new Date().toISOString(), actualCamera: true, syntheticDevice: false, calibrationMode: 'Identity transform for software profile gating; not a measured floor calibration', physicalFloorValidation: false, handGestureValidation: false, endToEndLatencyMeasured: false, baseUrl, devices: [], statuses: [], cameraFound: false, workerFrames: 0, calibrationGatingPassed: false, calibratedFramesPassed: false, stopClearedInputs: false, error: null };
page.on('console', message => { if (message.text().startsWith('vision-status:')) console.log(message.text()); if (message.type() === 'error' && /vision|wasm|mediapipe/i.test(message.text())) console.error(message.text().slice(0, 300)); });
try {
  await page.route(`${baseUrl}/__vision-smoke`, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><title>Local GoPro Verification</title></head><body>Camera verification. No recording.</body></html>' }));
  await page.goto(`${baseUrl}/__vision-smoke`, { waitUntil: 'domcontentloaded' });
  const found = await page.evaluate(async () => {
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'videoinput');
    const target = devices.find(device => /gopro|hero\s*\d+/i.test(device.label));
    return { devices: devices.map(device => device.label || '(camera permission not yet available)'), targetId: target?.deviceId };
  });
  report.devices = found.devices;
  if (!found.targetId) throw new Error('No GoPro camera was exposed to Chrome. No alternative camera was opened.');
  report.cameraFound = true;
  await page.evaluate(async deviceId => {
    const { createVisionController } = await import('/src/projection/vision/controller.ts');
    const { DEFAULT_SETTINGS } = await import('/src/projection/storage.ts');
    window.__visionFrames = [];
    window.__visionStatuses = [];
    window.__visionSettings = structuredClone(DEFAULT_SETTINGS);
    window.__visionSettings.cameraId = deviceId;
    window.__visionSettings.inputMode = 'camera';
    window.__visionController = createVisionController({ onFrame: frame => window.__visionFrames.push({ timestamp: frame.timestamp, presence: frame.presence.length, motion: frame.motion.length, impulses: frame.impulses.length }), onStatus: status => { window.__visionStatuses.push(status); console.info('vision-status:', status.state, status.message); } });
    window.__visionController.configure(window.__visionSettings);
    await window.__visionController.start(deviceId);
  }, found.targetId);
  await page.waitForFunction(() => window.__visionStatuses.filter(status => status.inferenceMs > 0).length >= 3, { timeout: 30000 });
  report.calibrationGatingPassed = await page.evaluate(() => window.__visionFrames.every(frame => frame.presence === 0 && frame.motion === 0 && frame.impulses === 0));
  await page.evaluate(() => {
    const status = window.__visionStatuses.at(-1);
    const settings = window.__visionSettings;
    settings.calibration = { ...settings.calibration, calibrated: true, cameraId: status.deviceId, cameraWidth: status.width, cameraHeight: status.height };
    window.__visionController.configure(settings);
    window.__calibrationStart = window.__visionStatuses.length;
  });
  await page.waitForFunction(() => window.__visionStatuses.slice(window.__calibrationStart).filter(status => status.state === 'ready' && status.inferenceMs > 0).length >= 3, { timeout: 30000 });
  report.calibratedFramesPassed = true;
  const runtime = await page.evaluate(() => ({ statuses: window.__visionStatuses.slice(-8).map(({ deviceId: _id, ...status }) => status), workerFrames: window.__visionStatuses.filter(status => status.inferenceMs > 0).length }));
  report.statuses = runtime.statuses;
  report.workerFrames = runtime.workerFrames;
  report.stopClearedInputs = await page.evaluate(() => {
    window.__visionController.stop();
    const frame = window.__visionFrames.at(-1);
    return window.__visionStatuses.at(-1).state === 'idle' && frame.presence === 0 && frame.motion === 0 && frame.impulses === 0 && document.querySelectorAll('video').length === 0;
  });
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  report.statuses = await page.evaluate(() => window.__visionStatuses?.slice(-8)?.map(({ deviceId: _id, ...status }) => status) ?? []).catch(() => []);
} finally {
  await page.evaluate(() => window.__visionController?.stop()).catch(() => {});
  await browser.close();
  await writeFile('artifacts/camera-smoke.json', `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}
if (report.error || !report.stopClearedInputs) process.exitCode = 1;
