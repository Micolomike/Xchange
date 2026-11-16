import { test, expect } from '@playwright/test';
import { AGENT, enterMfaCode, expectNoHorizontalOverflow, trackPageErrors } from './helpers.js';

// S'exécute après le projet « ordinateur », dont il réutilise les comptes et les tickets.
test('sur mobile, les pages tiennent dans l’écran et le menu fonctionne', async ({ page }) => {
  const pageErrors = trackPageErrors(page);

  await page.goto('/');
  await expectNoHorizontalOverflow(page);

  await page.goto('/login');
  await page.fill('#login-username', AGENT.username);
  await page.fill('#login-password', AGENT.password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await enterMfaCode(page, AGENT.username);
  await expect(page.getByRole('heading', { name: `Bonjour ${AGENT.firstname}` })).toBeVisible();
  await expect(page.getByRole('link', { name: '2 tickets de vos groupes attendent un responsable' })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.goto('/profile');
  await expect(page.getByRole('heading', { name: 'Double authentification' })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: 'Ouvrir le menu' }).click();
  await page.getByRole('link', { name: 'Tickets', exact: true }).click();
  await expect(page).toHaveURL(/\/tickets$/);
  await expect(page.getByText('8 tickets', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole('link', { name: 'Le VPN se coupe toutes les dix minutes' }).click();
  await expect(page.getByText('Je regarde les journaux')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: 'Ouvrir le menu' }).click();
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('suivie jusqu');
  await expectNoHorizontalOverflow(page);

  expect(pageErrors).toEqual([]);
});
