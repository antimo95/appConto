import { Routes } from '@angular/router';
import { AnalyticsPage } from './features/analytics/analytics-page';
import { CategoriesPage } from './features/categories/categories-page';
import { DashboardPage } from './features/dashboard/dashboard-page';
import { ImportPage } from './features/import/import-page';
import { LoanCreatePage } from './features/loans/loan-create-page';
import { LoanDetailPage } from './features/loans/loan-detail-page';
import { LoansPage } from './features/loans/loans-page';
import { MerchantsPage } from './features/merchants/merchants-page';
import type { PayslipsPage } from './features/payslips/payslips-page';
import { SettingsPage } from './features/settings/settings-page';
import { TransactionsPage } from './features/transactions/transactions-page';

export const routes: Routes = [
  { 
    path: '', 
    component: DashboardPage, 
    title: 'Riepilogo' 
  },
  { 
    path: 'analytics', 
    component: AnalyticsPage, 
    title: 'Analytics' 
  },
  { 
    path: 'transactions', 
    component: TransactionsPage, 
    title: 'Movimenti' 
  },
  {
    path: 'loans',
    component: LoansPage,
    title: 'Prestiti'
  },
  {
    // Registrata prima della rotta con parametro: 'new' non è l'id di un prestito.
    path: 'loans/new',
    component: LoanCreatePage,
    title: 'Crea prestito'
  },
  {
    path: 'loans/:id',
    component: LoanDetailPage,
    title: 'Prestito'
  },
  {
    path: 'merchants',
    component: MerchantsPage,
    title: 'Merchant'
  },
  {
    path: 'categories',
    component: CategoriesPage,
    title: 'Categorie'
  },
  {
    path: 'import',
    component: ImportPage,
    title: 'Import CSV'
  },
  { 
    path: 'settings', 
    component: SettingsPage, 
    title: 'Impostazioni' 
  },
  {
    path: 'payslips',
    // Caricata solo quando serve: la pagina porta con sé revisione, confronti e
    // riepilogo ferie, e il bundle iniziale è a ridosso del limite di budget.
    loadComponent: () =>
      import('./features/payslips/payslips-page').then((module) => module.PayslipsPage),
    // Solo il tipo: il componente resta caricato a richiesta.
    // Lasciare la pagina con una revisione toccata chiede conferma.
    canDeactivate: [(page: PayslipsPage) => page.confirmLeave()],
    title: 'Cedolini'
  },
  { path: '**', redirectTo: '' }
];
