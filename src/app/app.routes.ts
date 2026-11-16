import { Routes } from '@angular/router';
import { App } from './app';

/**
 * Two pages share one bundle and one set of data services:
 *   /        the dashboards (App — Review, School, Infrastructure, …)
 *   /glance  the standalone "At a glance" executive page (opened from the top
 *            menu in a new browser tab, like SMC)
 */
export const routes: Routes = [
  {
    path: 'glance',
    loadComponent: () => import('./glance/glance').then((m) => m.GlancePage),
    title: 'School Education Dashboard',
  },
  { path: '', component: App },
  { path: '**', redirectTo: '' },
];
