import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, Outlet } from 'react-router-dom';

import { AuthProvider, GuestOnly, useAuth } from './lib/auth.jsx';
import { MarketProvider } from './lib/market.jsx';
import { StrategyEngineProvider } from './lib/engine.jsx';
import { I18nProvider } from './lib/i18n.jsx';
import { CurrencyProvider } from './lib/currency.jsx';
import { SubscriptionProvider } from './lib/subscription.jsx';
import { UpgradeGate } from './components/Upgrade.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import ConsentBanner from './components/ConsentBanner.jsx';
import Shell from './components/Shell.jsx';
import PublicLayout from './components/PublicLayout.jsx';
import SeoManager from './components/SeoManager.jsx';

// Auth screens stay in the initial bundle (first-paint path); everything else is split.
import { LoginPage, RegisterPage, ForgotPage, ResetPage } from './pages/Auth.jsx';

const HomePage = lazy(() => import('./pages/Home.jsx'));
const TrendingPage = lazy(() => import('./pages/Trending.jsx'));
const BubblesPage = lazy(() => import('./pages/Bubbles.jsx'));
const WatchlistPage = lazy(() => import('./pages/Watchlist.jsx'));
const PortfolioPage = lazy(() => import('./pages/Portfolio.jsx'));
const AlertsPage = lazy(() => import('./pages/Alerts.jsx'));
const CalculatorPage = lazy(() => import('./pages/Calculator.jsx'));
const NewsPage = lazy(() => import('./pages/News.jsx'));
const FearGreedPage = lazy(() => import('./pages/FearGreed.jsx'));
const StrategiesPage = lazy(() => import('./pages/Strategies.jsx'));
const PaperTradingPage = lazy(() => import('./pages/PaperTrading.jsx'));
const RsiScannerPage = lazy(() => import('./pages/RsiScanner.jsx'));
const MarketIntelPage = lazy(() => import('./pages/MarketIntel.jsx'));
const DataSourcesPage = lazy(() => import('./pages/DataSources.jsx'));
const ExchangePage = lazy(() => import('./pages/Exchange.jsx'));
const AggregatorPage = lazy(() => import('./pages/Aggregator.jsx'));
const WalletLabPage = lazy(() => import('./pages/WalletLab.jsx'));
const ExplorerPage = lazy(() => import('./pages/Explorer.jsx'));
const BotsPage = lazy(() => import('./pages/Bots.jsx'));
const DeFiNftPage = lazy(() => import('./pages/DeFiNft.jsx'));
const AssistantPage = lazy(() => import('./pages/Assistant.jsx'));
const ChartingPage = lazy(() => import('./pages/Charting.jsx'));
const DerivativesPage = lazy(() => import('./pages/Derivatives.jsx'));
const CoinDetailPage = lazy(() => import('./pages/CoinDetail.jsx'));
const StatusPage = lazy(() => import('./pages/Status.jsx'));
const LegalPage = lazy(() => import('./pages/Legal.jsx'));
const NotFoundPage = lazy(() => import('./pages/NotFound.jsx'));
const RegionPage = lazy(() => import('./pages/Region.jsx'));
const AccountPage = lazy(() => import('./pages/Account.jsx'));
const OrganizationPage = lazy(() => import('./pages/Organization.jsx'));
const BillingPage = lazy(() => import('./pages/Billing.jsx'));
const PricingPage = lazy(() => import('./pages/Pricing.jsx'));
const UpgradeSuccessPage = lazy(() => import('./pages/UpgradeSuccess.jsx'));
const CompliancePage = lazy(() => import('./pages/Compliance.jsx'));
const LandingPage = lazy(() => import('./pages/Landing.jsx'));
const GuidesPage = lazy(() => import('./pages/Guides.jsx'));
const GuideArticlePage = lazy(() => import('./pages/GuideArticle.jsx'));
const SearchPage = lazy(() => import('./pages/Search.jsx'));
const CopyTradingPage = lazy(() => import('./pages/CopyTrading.jsx'));
const LaunchpadPage = lazy(() => import('./pages/Launchpad.jsx'));
const AcademyPage = lazy(() => import('./pages/Academy.jsx'));
const ReferralPage = lazy(() => import('./pages/Referral.jsx'));
const AdminPage = lazy(() => import('./pages/Admin.jsx'));

export function PageFallback() {
  return (
    <div role="status" className="flex h-[50vh] items-center justify-center text-sm text-muted-foreground">
      Loading…
    </div>
  );
}

/* The gate in front of the authenticated app.
 *
 * `"/"` is the one URL a crawler, an AI answer or a first-time visitor is most
 * likely to open, so it cannot be a login wall: a signed-out request for `/`
 * gets the marketing page, a signed-in one gets the dashboard. Every other
 * deep link keeps the old behaviour — redirect to /login and come back after
 * signing in — because silently swapping a bookmarked screen for a pitch would
 * be worse than the redirect.
 */
function AppBoundary() {
  const { session, authReady } = useAuth();
  const loc = useLocation();
  if (!authReady) return <PageFallback />;
  if (session) return <Shell />;
  if (loc.pathname === '/') {
    return (
      <PublicLayout>
        <LandingPage />
      </PublicLayout>
    );
  }
  return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
}

function ScrollToTop() {
  const { pathname } = useLocation();
  React.useEffect(() => {
    const main = document.getElementById('main-content');
    if (main) main.scrollTop = 0;
    else window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export default function App() {
  return (
    <ErrorBoundary label="root">
      <I18nProvider>
        <CurrencyProvider>
      <AuthProvider>
        <SubscriptionProvider>
        <MarketProvider>
          <BrowserRouter>
            <ScrollToTop />
            <ConsentBanner />
            <SeoManager />
            <StrategyEngineProvider>
              <Suspense fallback={<PageFallback />}>
                <Routes>
                  {/* ---- Public and indexable -------------------------------
                      These render without a session, carry their own metadata
                      (src/lib/routes.js) and are the only URLs in sitemap.xml.
                      Everything below <RequireAuth> is deliberately absent
                      from the sitemap: a crawler that follows it only ever
                      sees the login wall. */}
                  <Route path="/welcome" element={<Navigate to="/" replace />} />
                  <Route element={<PublicLayout />}>
                    <Route path="/pricing" element={<PricingPage />} />
                    <Route path="/status" element={<StatusPage />} />
                    <Route path="/data-sources" element={<DataSourcesPage />} />
                    <Route path="/guides" element={<GuidesPage />} />
                    <Route path="/guides/:slug" element={<GuideArticlePage />} />
                    <Route path="/compliance" element={<CompliancePage />} />
                    <Route path="/legal/:doc" element={<LegalPage />} />
                  </Route>

                  {/* ---- Public, not indexable (auth screens) ---- */}
                  <Route path="/login" element={<GuestOnly><LoginPage /></GuestOnly>} />
                  <Route path="/register" element={<GuestOnly><RegisterPage /></GuestOnly>} />
                  <Route path="/forgot-password" element={<GuestOnly><ForgotPage /></GuestOnly>} />
                  <Route path="/reset-password" element={<GuestOnly><ResetPage /></GuestOnly>} />

                  {/* Authenticated app */}
                  <Route
                    element={
                      <AppBoundary />
                    }
                  >
                    <Route path="/" element={<HomePage />} />
                    <Route path="/trending" element={<TrendingPage />} />
                    <Route path="/bubbles" element={<BubblesPage />} />
                    <Route path="/fear-greed" element={<FearGreedPage />} />
                    <Route path="/watchlist" element={<WatchlistPage />} />
                    <Route path="/portfolio" element={<PortfolioPage />} />
                    <Route path="/alerts" element={<AlertsPage />} />
                    <Route path="/derivatives" element={<UpgradeGate><DerivativesPage /></UpgradeGate>} />
                    <Route path="/charting" element={<ChartingPage />} />
                    <Route path="/exchange" element={<UpgradeGate><ExchangePage /></UpgradeGate>} />
                    <Route path="/aggregator" element={<AggregatorPage />} />
                    <Route path="/wallet-lab" element={<WalletLabPage />} />
                    <Route path="/explorer" element={<ExplorerPage />} />
                    <Route path="/bots" element={<UpgradeGate><BotsPage /></UpgradeGate>} />
                    <Route path="/defi" element={<DeFiNftPage />} />
                    <Route path="/assistant" element={<AssistantPage />} />
                    <Route path="/rsi-scanner" element={<RsiScannerPage />} />
                    <Route path="/market-intel" element={<MarketIntelPage />} />
                    <Route path="/data-sources" element={<DataSourcesPage />} />
                    <Route path="/strategies" element={<UpgradeGate><StrategiesPage /></UpgradeGate>} />
                    <Route path="/paper-trading" element={<PaperTradingPage />} />
                    <Route path="/calculator" element={<CalculatorPage />} />
                    <Route path="/news" element={<NewsPage />} />
                    <Route path="/status" element={<StatusPage />} />
                    <Route path="/region" element={<RegionPage />} />
                    <Route path="/account" element={<AccountPage />} />
                    <Route path="/organization" element={<OrganizationPage />} />
                    <Route path="/billing" element={<BillingPage />} />
                    <Route path="/pricing" element={<PricingPage />} />
        {/* Where Lemon Squeezy returns a buyer after checkout. It confirms
            nothing by itself; it re-reads the subscription the webhook writes. */}
        <Route path="/upgrade/success" element={<UpgradeSuccessPage />} />
                    <Route path="/compliance" element={<CompliancePage />} />
                    <Route path="/search" element={<SearchPage />} />
                    <Route path="/copy-trading" element={<CopyTradingPage />} />
                    <Route path="/launchpad" element={<LaunchpadPage />} />
                    <Route path="/academy" element={<AcademyPage />} />
                    <Route path="/referral" element={<ReferralPage />} />
                    <Route path="/admin" element={<AdminPage />} />
                    <Route path="/coin/:id" element={<CoinDetailPage />} />
                    <Route path="/404" element={<NotFoundPage />} />
                    <Route path="*" element={<Navigate to="/404" replace />} />
                  </Route>
                </Routes>
              </Suspense>
            </StrategyEngineProvider>
          </BrowserRouter>
        </MarketProvider>
        </SubscriptionProvider>
      </AuthProvider>
        </CurrencyProvider>
      </I18nProvider>
    </ErrorBoundary>
  );
}
