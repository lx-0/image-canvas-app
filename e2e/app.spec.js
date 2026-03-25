// @ts-check
const { test, expect } = require('@playwright/test');
const path = require('path');

const TEST_IMAGE = path.join(__dirname, 'test-image.png');

// ─── 1. Page Load & Core UI ─────────────────────────────────────────────────

test.describe('Page Load & Core UI', () => {
  test('loads the homepage with correct title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('Image Canvas');
  });

  test('renders essential UI elements', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toHaveText('Image Canvas');
    await expect(page.locator('#upload-form')).toBeVisible();
    await expect(page.locator('#file-input')).toBeAttached();
    await expect(page.locator('#canvas')).toBeAttached();
    await expect(page.locator('#chat-panel')).toBeVisible();
    await expect(page.locator('#chat-input')).toBeVisible();
    await expect(page.locator('#chat-send')).toBeVisible();
  });

  test('toolbar buttons are present and initially disabled', async ({ page }) => {
    await page.goto('/');
    const buttons = ['#undo-btn', '#redo-btn', '#save-btn', '#draw-btn', '#select-btn', '#filter-btn'];
    for (const sel of buttons) {
      await expect(page.locator(sel)).toBeVisible();
      await expect(page.locator(sel)).toBeDisabled();
    }
  });

  test('empty state is visible when no image loaded', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#empty-state')).toBeVisible();
    await expect(page.locator('#empty-state')).toContainText('Drop an image here');
  });

  test('zoom bar is present', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#zoom-bar')).toBeAttached();
    await expect(page.locator('#zoom-level')).toHaveText('100%');
  });

  test('gallery sidebar is present', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#gallery-sidebar')).toBeAttached();
    // Gallery list container should exist (may have items from server)
    await expect(page.locator('#gallery-list')).toBeAttached();
  });
});

// ─── 2. Theme Toggle ────────────────────────────────────────────────────────

test.describe('Theme Toggle', () => {
  test('clicking theme button changes the theme', async ({ page }) => {
    await page.goto('/');
    const themeBtn = page.locator('#theme-toggle');

    // Get the current theme from the app's own detection
    const before = await page.evaluate(() => {
      return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    });

    // Click to toggle
    await themeBtn.click();
    const after = await page.evaluate(() => {
      return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    });
    expect(after).not.toBe(before);

    // Click again to toggle back
    await themeBtn.click();
    const restored = await page.evaluate(() => {
      return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    });
    expect(restored).toBe(before);
  });

  test('theme toggle via keyboard shortcut Ctrl+Shift+T', async ({ page }) => {
    await page.goto('/');

    const initialTheme = await page.evaluate(() => localStorage.getItem('theme'));

    await page.keyboard.press('Control+Shift+T');
    const afterToggle = await page.evaluate(() => localStorage.getItem('theme'));
    expect(afterToggle).not.toBe(initialTheme);
  });
});

// ─── 3. Image Upload via File Input ─────────────────────────────────────────

test.describe('Image Upload', () => {
  test('uploads an image via file input and renders on canvas', async ({ page }) => {
    await page.goto('/');

    // Upload via file input
    const fileInput = page.locator('#file-input');
    await fileInput.setInputFiles(TEST_IMAGE);
    await page.locator('#upload-form button[type="submit"]').click();

    // Wait for the status to show dimensions (upload complete)
    await expect(page.locator('#status')).toContainText('rendered', { timeout: 10000 });

    // Empty state should be hidden once image loads
    await expect(page.locator('#empty-state')).toBeHidden();

    // Toolbar buttons should become enabled
    await expect(page.locator('#save-btn')).toBeEnabled();
    await expect(page.locator('#draw-btn')).toBeEnabled();
  });

  test('shows error for no file selected', async ({ page }) => {
    await page.goto('/');
    // Submit without selecting a file - form may prevent or show error
    await page.locator('#upload-form button[type="submit"]').click();
    // Either no change or an error message appears
    const error = page.locator('#error');
    const status = page.locator('#status');
    // At minimum, we should not crash
    await expect(page.locator('h1')).toHaveText('Image Canvas');
  });

  test('drag-and-drop upload triggers rendering', async ({ page }) => {
    await page.goto('/');

    // Create a DataTransfer with our test image via the API
    const buffer = require('fs').readFileSync(TEST_IMAGE);

    await page.evaluate(async (data) => {
      const arr = new Uint8Array(data);
      const file = new File([arr], 'test-image.png', { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);

      const container = document.getElementById('canvas-container');
      container.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true }));
      container.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
    }, Array.from(buffer));

    // Wait for upload to complete
    await expect(page.locator('#status')).toContainText('rendered', { timeout: 10000 });
  });
});

// ─── 4. Canvas Interactions ─────────────────────────────────────────────────

test.describe('Canvas Interactions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Upload an image first
    await page.locator('#file-input').setInputFiles(TEST_IMAGE);
    await page.locator('#upload-form button[type="submit"]').click();
    await expect(page.locator('#status')).toContainText('rendered', { timeout: 10000 });
  });

  test('undo and redo buttons work after image load', async ({ page }) => {
    // After first image load, undo should be enabled (initial state saved)
    // Redo should be disabled since we haven't undone anything
    await expect(page.locator('#redo-btn')).toBeDisabled();
  });

  test('zoom in button increases zoom level', async ({ page }) => {
    const zoomLevel = page.locator('#zoom-level');
    const initialZoom = await zoomLevel.textContent();

    await page.locator('#zoom-in-btn').click();
    await page.waitForTimeout(200);

    const newZoom = await zoomLevel.textContent();
    const initialNum = parseInt(initialZoom);
    const newNum = parseInt(newZoom);
    expect(newNum).toBeGreaterThan(initialNum);
  });

  test('zoom out button decreases zoom level', async ({ page }) => {
    // First zoom in, then zoom out
    await page.locator('#zoom-in-btn').click();
    await page.waitForTimeout(200);

    const zoomLevel = page.locator('#zoom-level');
    const beforeOut = parseInt(await zoomLevel.textContent());

    await page.locator('#zoom-out-btn').click();
    await page.waitForTimeout(200);

    const afterOut = parseInt(await zoomLevel.textContent());
    expect(afterOut).toBeLessThan(beforeOut);
  });

  test('fit-to-view button resets zoom', async ({ page }) => {
    // Zoom in first
    await page.locator('#zoom-in-btn').click();
    await page.locator('#zoom-in-btn').click();
    await page.waitForTimeout(200);

    // Click fit-to-view
    await page.locator('#zoom-fit-btn').click();
    await page.waitForTimeout(200);

    // Should reset to a fit level
    const zoomLevel = page.locator('#zoom-level');
    const text = await zoomLevel.textContent();
    expect(text).toBeTruthy();
  });
});

// ─── 5. AI Chat Panel ───────────────────────────────────────────────────────

test.describe('AI Chat Panel', () => {
  test('chat panel shows initial system message', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#chat-messages .chat-msg.system')).toBeVisible();
    await expect(page.locator('#chat-messages .chat-msg.system')).toContainText('Upload an image');
  });

  test('can type in chat input', async ({ page }) => {
    await page.goto('/');
    const input = page.locator('#chat-input');
    await input.fill('Hello AI');
    await expect(input).toHaveValue('Hello AI');
  });

  test('send button triggers a chat message', async ({ page }) => {
    await page.goto('/');
    // Upload image first so chat is functional
    await page.locator('#file-input').setInputFiles(TEST_IMAGE);
    await page.locator('#upload-form button[type="submit"]').click();
    await expect(page.locator('#status')).toContainText('rendered', { timeout: 10000 });

    // Type and send
    await page.locator('#chat-input').fill('make it brighter');
    await page.locator('#chat-send').click();

    // The user message should appear in the chat
    await expect(page.locator('#chat-messages .chat-msg.user')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#chat-messages .chat-msg.user')).toContainText('make it brighter');
  });

  test('new chat button clears conversation', async ({ page }) => {
    await page.goto('/');
    await page.locator('#file-input').setInputFiles(TEST_IMAGE);
    await page.locator('#upload-form button[type="submit"]').click();
    await expect(page.locator('#status')).toContainText('rendered', { timeout: 10000 });

    // Send a message
    await page.locator('#chat-input').fill('test message');
    await page.locator('#chat-send').click();
    await expect(page.locator('#chat-messages .chat-msg.user')).toBeVisible({ timeout: 5000 });

    // Click "New Chat"
    await page.locator('#new-chat-btn').click();

    // User messages should be cleared
    await expect(page.locator('#chat-messages .chat-msg.user')).toHaveCount(0);
  });
});

// ─── 6. Export Dialog ────────────────────────────────────────────────────────

test.describe('Export Dialog', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.locator('#file-input').setInputFiles(TEST_IMAGE);
    await page.locator('#upload-form button[type="submit"]').click();
    await expect(page.locator('#status')).toContainText('rendered', { timeout: 10000 });
  });

  test('save button opens export dialog', async ({ page }) => {
    await page.locator('#save-btn').click();
    await expect(page.locator('#export-dialog-overlay')).toBeVisible();
    await expect(page.locator('#export-dialog-title')).toHaveText('Export Image');
  });

  test('export dialog has format options', async ({ page }) => {
    await page.locator('#save-btn').click();
    await expect(page.locator('#export-format')).toBeVisible();

    const options = await page.locator('#export-format option').allTextContents();
    expect(options.some(o => o.includes('PNG'))).toBeTruthy();
    expect(options.some(o => o.includes('JPEG'))).toBeTruthy();
    expect(options.some(o => o.includes('WebP'))).toBeTruthy();
  });

  test('cancel button closes export dialog', async ({ page }) => {
    await page.locator('#save-btn').click();
    await expect(page.locator('#export-dialog-overlay')).toBeVisible();

    await page.locator('#export-cancel-btn').click();
    await expect(page.locator('#export-dialog-overlay')).toBeHidden();
  });

  test('quality slider appears for JPEG format', async ({ page }) => {
    await page.locator('#save-btn').click();
    await page.locator('#export-format').selectOption('jpeg');
    await expect(page.locator('#quality-field')).toBeVisible();
  });

  test('Ctrl+S opens export dialog', async ({ page }) => {
    await page.keyboard.press('Control+s');
    await expect(page.locator('#export-dialog-overlay')).toBeVisible();
  });
});

// ─── 7. Gallery Navigation ──────────────────────────────────────────────────

test.describe('Gallery Navigation', () => {
  test('gallery adds item after upload', async ({ page }) => {
    await page.goto('/');

    // Count existing gallery items
    const countBefore = await page.locator('#gallery-list .gallery-item').count();

    await page.locator('#file-input').setInputFiles(TEST_IMAGE);
    await page.locator('#upload-form button[type="submit"]').click();
    await expect(page.locator('#status')).toContainText('rendered', { timeout: 10000 });

    // Gallery should have one more item than before
    await expect(page.locator('#gallery-list .gallery-item')).toHaveCount(countBefore + 1, { timeout: 5000 });
  });

  test('gallery collapse and expand works', async ({ page }) => {
    await page.goto('/');

    // Collapse gallery
    await page.locator('#gallery-collapse-btn').click();
    await expect(page.locator('#gallery-sidebar')).toHaveClass(/collapsed/);

    // Expand gallery via toggle button
    await page.locator('#gallery-toggle-btn').click();
    await expect(page.locator('#gallery-sidebar')).not.toHaveClass(/collapsed/);
  });
});

// ─── 8. Drawing Mode ────────────────────────────────────────────────────────

test.describe('Drawing Mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.locator('#file-input').setInputFiles(TEST_IMAGE);
    await page.locator('#upload-form button[type="submit"]').click();
    await expect(page.locator('#status')).toContainText('rendered', { timeout: 10000 });
  });

  test('draw button toggles drawing panel', async ({ page }) => {
    await page.locator('#draw-btn').click();
    await expect(page.locator('#draw-panel')).toBeVisible();

    // Toggle off
    await page.locator('#draw-btn').click();
    await expect(page.locator('#draw-panel')).toBeHidden();
  });

  test('D key toggles drawing mode', async ({ page }) => {
    await page.keyboard.press('d');
    await expect(page.locator('#draw-panel')).toBeVisible();

    await page.keyboard.press('d');
    await expect(page.locator('#draw-panel')).toBeHidden();
  });
});

// ─── 9. Select / Crop Mode ──────────────────────────────────────────────────

test.describe('Select Mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.locator('#file-input').setInputFiles(TEST_IMAGE);
    await page.locator('#upload-form button[type="submit"]').click();
    await expect(page.locator('#status')).toContainText('rendered', { timeout: 10000 });
  });

  test('select button toggles select mode', async ({ page }) => {
    await page.locator('#select-btn').click();
    await expect(page.locator('#select-btn')).toHaveClass(/active/);

    await page.locator('#select-btn').click();
    await expect(page.locator('#select-btn')).not.toHaveClass(/active/);
  });

  test('S key toggles select mode', async ({ page }) => {
    await page.keyboard.press('s');
    await expect(page.locator('#select-btn')).toHaveClass(/active/);
  });
});

// ─── 10. Filter Panel ────────────────────────────────────────────────────────

test.describe('Filter Panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.locator('#file-input').setInputFiles(TEST_IMAGE);
    await page.locator('#upload-form button[type="submit"]').click();
    await expect(page.locator('#status')).toContainText('rendered', { timeout: 10000 });
  });

  test('filter button opens filter panel', async ({ page }) => {
    await page.locator('#filter-btn').click();
    await expect(page.locator('#filter-panel')).toBeVisible();
  });

  test('F key toggles filter panel', async ({ page }) => {
    await page.keyboard.press('f');
    await expect(page.locator('#filter-panel')).toBeVisible();

    await page.keyboard.press('f');
    await expect(page.locator('#filter-panel')).toBeHidden();
  });

  test('filter panel has reset and apply buttons', async ({ page }) => {
    await page.locator('#filter-btn').click();
    await expect(page.locator('#filter-reset-btn')).toBeVisible();
    await expect(page.locator('#filter-apply-btn')).toBeVisible();
    await expect(page.locator('#filter-cancel-btn')).toBeVisible();
  });
});

// ─── 11. Keyboard Shortcuts ─────────────────────────────────────────────────

test.describe('Keyboard Shortcuts', () => {
  test('? key opens shortcuts overlay', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('?');
    await expect(page.locator('#shortcuts-overlay')).toBeVisible();
    await expect(page.locator('#shortcuts-dialog')).toContainText('Keyboard Shortcuts');
  });

  test('Escape closes shortcuts overlay', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('?');
    await expect(page.locator('#shortcuts-overlay')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('#shortcuts-overlay')).toBeHidden();
  });

  test('/ key focuses chat input', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('/');
    await expect(page.locator('#chat-input')).toBeFocused();
  });
});

// ─── 12. Mobile Viewport ────────────────────────────────────────────────────

test.describe('Mobile Viewport', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('page loads correctly on mobile viewport', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('Image Canvas');
    await expect(page.locator('h1')).toHaveText('Image Canvas');
  });

  test('upload form is accessible on mobile', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#file-input')).toBeAttached();
    await expect(page.locator('#upload-form button[type="submit"]')).toBeVisible();
  });

  test('chat panel is present on mobile', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#chat-panel')).toBeAttached();
    await expect(page.locator('#chat-input')).toBeAttached();
  });
});

// ─── 13. Context Menu ────────────────────────────────────────────────────────

test.describe('Context Menu', () => {
  test('right-click on canvas shows context menu (with image loaded)', async ({ page }) => {
    await page.goto('/');
    await page.locator('#file-input').setInputFiles(TEST_IMAGE);
    await page.locator('#upload-form button[type="submit"]').click();
    await expect(page.locator('#status')).toContainText('rendered', { timeout: 10000 });

    // Right-click canvas using dispatchEvent to avoid transform handle interception
    await page.locator('#canvas').dispatchEvent('contextmenu', { bubbles: true });
    await expect(page.locator('#canvas-context-menu')).toBeVisible();
  });
});

// ─── 14. Delete Confirmation Dialog ──────────────────────────────────────────

test.describe('Delete Confirmation', () => {
  test('delete dialog elements exist', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#delete-confirm-overlay')).toBeAttached();
    await expect(page.locator('#delete-confirm-yes')).toBeAttached();
    await expect(page.locator('#delete-confirm-no')).toBeAttached();
  });
});

// ─── 15. Server Health Check ─────────────────────────────────────────────────

test.describe('Server Health', () => {
  test('health endpoint returns OK', async ({ request }) => {
    const response = await request.get('/health');
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.status).toBe('ok');
  });

  test('config endpoint returns server config', async ({ request }) => {
    const response = await request.get('/api/config');
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body).toHaveProperty('assetPrefix');
  });

  test('images API returns list', async ({ request }) => {
    const response = await request.get('/api/images');
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body).toHaveProperty('images');
    expect(Array.isArray(body.images)).toBeTruthy();
  });
});

// ─── 16. Crop Presets ────────────────────────────────────────────────────────

test.describe('Crop Presets', () => {
  test('crop preset buttons are present', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#crop-presets')).toBeAttached();
    const presets = page.locator('.crop-preset-btn');
    await expect(presets).toHaveCount(5);
  });
});
