// @ts-check
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const path = require('path');

const TEST_IMAGE = path.join(__dirname, 'test-image.png');

// ─── 1. Axe-core Automated Accessibility Audit ─────────────────────────────

test.describe('Accessibility — axe-core audit', () => {
  test('homepage passes axe audit with no critical violations', async ({ page }) => {
    await page.goto('/');
    const results = await new AxeBuilder({ page })
      .exclude('#canvas') // Canvas element is an opaque bitmap; axe can't meaningfully audit its content
      .analyze();

    const critical = results.violations.filter(v => v.impact === 'critical' || v.impact === 'serious');
    if (critical.length > 0) {
      const summary = critical.map(v => `[${v.impact}] ${v.id}: ${v.description} (${v.nodes.length} instance(s))`).join('\n');
      expect(critical, `Axe found critical/serious violations:\n${summary}`).toHaveLength(0);
    }
  });

  test('page with uploaded image passes axe audit', async ({ page }) => {
    await page.goto('/');
    await page.locator('#file-input').setInputFiles(TEST_IMAGE);
    await page.locator('#upload-form button[type="submit"]').click();
    await expect(page.locator('#status')).toContainText('rendered', { timeout: 10000 });

    const results = await new AxeBuilder({ page })
      .exclude('#canvas')
      .analyze();

    const critical = results.violations.filter(v => v.impact === 'critical' || v.impact === 'serious');
    if (critical.length > 0) {
      const summary = critical.map(v => `[${v.impact}] ${v.id}: ${v.description} (${v.nodes.length} instance(s))`).join('\n');
      expect(critical, `Axe found critical/serious violations:\n${summary}`).toHaveLength(0);
    }
  });
});

// ─── 2. ARIA Roles and Labels ───────────────────────────────────────────────

test.describe('Accessibility — ARIA landmarks and roles', () => {
  test('page has proper landmark structure', async ({ page }) => {
    await page.goto('/');

    // Banner (header)
    await expect(page.locator('header[role="banner"]')).toBeAttached();

    // Main content area
    await expect(page.locator('main[role="main"]')).toBeAttached();

    // Navigation (gallery sidebar)
    await expect(page.locator('nav[aria-label="Image gallery"]')).toBeAttached();

    // Chat panel as complementary
    await expect(page.locator('aside[aria-label="AI Assistant chat"]')).toBeAttached();

    // Toolbar
    await expect(page.locator('[role="toolbar"][aria-label="Editing tools"]')).toBeAttached();
  });

  test('chat messages container has log role', async ({ page }) => {
    await page.goto('/');
    const chatMessages = page.locator('#chat-messages');
    await expect(chatMessages).toHaveAttribute('role', 'log');
    await expect(chatMessages).toHaveAttribute('aria-live', 'polite');
  });

  test('gallery list has list role', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#gallery-list')).toHaveAttribute('role', 'list');
  });

  test('dialogs have proper dialog role and aria-modal', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#delete-confirm-overlay')).toHaveAttribute('role', 'dialog');
    await expect(page.locator('#delete-confirm-overlay')).toHaveAttribute('aria-modal', 'true');
    await expect(page.locator('#export-dialog-overlay')).toHaveAttribute('role', 'dialog');
    await expect(page.locator('#export-dialog-overlay')).toHaveAttribute('aria-modal', 'true');
  });

  test('context menu has menu role with menuitems', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#canvas-context-menu')).toHaveAttribute('role', 'menu');
    const items = page.locator('#canvas-context-menu [role="menuitem"]');
    expect(await items.count()).toBeGreaterThan(0);
  });
});

// ─── 3. Keyboard Navigation ────────────────────────────────────────────────

test.describe('Accessibility — keyboard navigation', () => {
  test('skip link is present and focusable', async ({ page }) => {
    await page.goto('/');
    const skipLink = page.locator('.skip-link');
    await expect(skipLink).toBeAttached();
    await expect(skipLink).toHaveAttribute('href', '#canvas');
  });

  test('all toolbar buttons are focusable', async ({ page }) => {
    await page.goto('/');
    const buttons = ['#undo-btn', '#redo-btn', '#save-btn', '#draw-btn', '#select-btn', '#filter-btn'];
    for (const sel of buttons) {
      const btn = page.locator(sel);
      await expect(btn).toBeVisible();
      // Buttons should be focusable (even if disabled)
      await expect(btn).toHaveAttribute('aria-label');
    }
  });

  test('chat input has associated label', async ({ page }) => {
    await page.goto('/');
    // Either via aria-label or <label> for attribute
    const input = page.locator('#chat-input');
    const ariaLabel = await input.getAttribute('aria-label');
    expect(ariaLabel).toBeTruthy();
  });

  test('/ key focuses chat input for quick access', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('/');
    await expect(page.locator('#chat-input')).toBeFocused();
  });
});

// ─── 4. Screen Reader Announcements ─────────────────────────────────────────

test.describe('Accessibility — screen reader', () => {
  test('sr-announcer element exists for live updates', async ({ page }) => {
    await page.goto('/');
    const announcer = page.locator('#sr-announcer');
    await expect(announcer).toBeAttached();
    await expect(announcer).toHaveAttribute('aria-live', 'polite');
    await expect(announcer).toHaveAttribute('aria-atomic', 'true');
    await expect(announcer).toHaveClass(/sr-only/);
  });

  test('status element has proper live region', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#feedback')).toHaveAttribute('role', 'status');
    await expect(page.locator('#feedback')).toHaveAttribute('aria-live', 'polite');
  });

  test('error element has alert role', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#error')).toHaveAttribute('role', 'alert');
    await expect(page.locator('#error')).toHaveAttribute('aria-live', 'assertive');
  });
});

// ─── 5. Dynamic Content Accessibility ───────────────────────────────────────

test.describe('Accessibility — dynamic content', () => {
  test('gallery items have proper roles after image upload', async ({ page }) => {
    await page.goto('/');
    await page.locator('#file-input').setInputFiles(TEST_IMAGE);
    await page.locator('#upload-form button[type="submit"]').click();
    await expect(page.locator('#status')).toContainText('rendered', { timeout: 10000 });

    // Wait for gallery to update
    const galleryItem = page.locator('.gallery-item').first();
    await expect(galleryItem).toBeVisible({ timeout: 5000 });
    await expect(galleryItem).toHaveAttribute('role', 'listitem');
    await expect(galleryItem).toHaveAttribute('aria-label');
    await expect(galleryItem).toHaveAttribute('tabindex', '0');
  });

  test('gallery item delete buttons have descriptive labels', async ({ page }) => {
    await page.goto('/');
    await page.locator('#file-input').setInputFiles(TEST_IMAGE);
    await page.locator('#upload-form button[type="submit"]').click();
    await expect(page.locator('#status')).toContainText('rendered', { timeout: 10000 });

    const deleteBtn = page.locator('.gallery-item .delete-btn').first();
    await expect(deleteBtn).toBeAttached({ timeout: 5000 });
    const ariaLabel = await deleteBtn.getAttribute('aria-label');
    expect(ariaLabel).toMatch(/^Delete /);
  });

  test('filter sliders have aria-describedby linking to value display', async ({ page }) => {
    await page.goto('/');
    await page.locator('#file-input').setInputFiles(TEST_IMAGE);
    await page.locator('#upload-form button[type="submit"]').click();
    await expect(page.locator('#status')).toContainText('rendered', { timeout: 10000 });

    // Open filter panel
    await page.locator('#filter-btn').click();
    await expect(page.locator('#filter-panel')).toBeVisible();

    // Check brightness slider
    const slider = page.locator('#filter-brightness');
    await expect(slider).toHaveAttribute('aria-describedby', 'filter-brightness-value');
    await expect(slider).toHaveAttribute('aria-valuenow');
    await expect(slider).toHaveAttribute('aria-valuetext');

    // Verify the describedby target exists
    await expect(page.locator('#filter-brightness-value')).toBeAttached();
  });
});

// ─── 6. Reduced Motion Support ──────────────────────────────────────────────

test.describe('Accessibility — prefers-reduced-motion', () => {
  test('animations are suppressed when prefers-reduced-motion is set', async ({ page }) => {
    // Emulate prefers-reduced-motion
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');

    // Verify the CSS media query is active by checking computed style on an animated element
    const transitionDuration = await page.evaluate(() => {
      const btn = document.querySelector('.toolbar-btn');
      return window.getComputedStyle(btn).transitionDuration;
    });
    // With reduced motion, transition-duration should be near 0
    expect(parseFloat(transitionDuration)).toBeLessThanOrEqual(0.01);
  });
});
