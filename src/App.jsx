import React, { Suspense, lazy } from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';

import { AuthProvider, RequireAuth, GuestOnly } from './lib/auth.jsx';
import { MarketProvider } from './lib/market.jsx';
import { StrategyEngineProvider } from './lib/engine.jsx';
import { I18nProvider } from './lib/i18n.jsx';
import { CurrencyProvider } from './lib/currency.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import ConsentBanner from './components/ConsentBanner.jsx';
import Shell from './components/Shell.jsx';

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
const ChartingPage = lazy(() => import('./pages/Charting.jsx'));
const DerivativesPage = lazy(() => import('./pages/Derivatives.jsx'));
const CoinDetailPage = lazy(() => import('./pages/CoinDetail.jsx'));
const StatusPage = lazy(() => import('./pages/Status.jsx'));
const LegalPage = lazy(() => import('./pages/Legal.jsx'));
const NotFoundPage = lazy(() => import('./pages/NotFound.jsx'));

export function PageFallback() {
  return (
    <div role="status" className="flex h-[50vh] items-center justify-center text-sm text-muted-foreground">
      Loading…
    </div>
  );
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
        <MarketProvider>
          <HashRouter>
            <ScrollToTop />
            <ConsentBanner />
            <StrategyEngineProvider>
              <Suspense fallback={<PageFallback />}>
                <Routes>
                  {/* Public */}
                  <Route path="/login" element={<GuestOnly><LoginPage /></GuestOnly>} />
                  <Route path="/register" element={<GuestOnly><RegisterPage /></GuestOnly>} />
                  <Route path="/forgot-password" element={<GuestOnly><ForgotPage /></GuestOnly>} />
                  <Route path="/reset-password" element={<GuestOnly><ResetPage /></GuestOnly>} />
                  <Route path="/legal/:doc" element={<LegalPage />} />

                  {/* Authenticated app */}
                  <Route
                    element={
                      <RequireAuth>
                        <Shell />
                      </RequireAuth>
                    }
                  >
                    <Route path="/" element={<HomePage />} />
                    <Route path="/trending" element={<TrendingPage />} />
                    <Route path="/bubbles" element={<BubblesPage />} />
                    <Route path="/fear-greed" element={<FearGreedPage />} />
                    <Route path="/watchlist" element={<WatchlistPage />} />
                    <Route path="/portfolio" element={<PortfolioPage />} />
                    <Route path="/alerts" element={<AlertsPage />} />
                    <Route path="/derivatives" element={<DerivativesPage />} />
                    <Route path="/charting" element={<ChartingPage />} />
                    <Route path="/exchange" element={<ExchangePage />} />
                    <Route path="/aggregator" element={<AggregatorPage />} />
                    <Route path="/wallet-lab" element={<WalletLabPage />} />
                    <Route path="/explorer" element={<ExplorerPage />} />
                    <Route path="/bots" element={<BotsPage />} />
                    <Route path="/defi" element={<DeFiNftPage />} />
                    <Route path="/rsi-scanner" element={<RsiScannerPage />} />
                    <Route path="/market-intel" element={<MarketIntelPage />} />
                    <Route path="/data-sources" element={<DataSourcesPage />} />
                    <Route path="/strategies" element={<StrategiesPage />} />
                    <Route path="/paper-trading" element={<PaperTradingPage />} />
                    <Route path="/calculator" element={<CalculatorPage />} />
                    <Route path="/news" element={<NewsPage />} />
                    <Route path="/status" element={<StatusPage />} />
                    <Route path="/coin/:id" element={<CoinDetailPage />} />
                    <Route path="/404" element={<NotFoundPage />} />
                    <Route path="*" element={<Navigate to="/404" replace />} />
                  </Route>
                </Routes>
              </Suspense>
            </StrategyEngineProvider>
          </HashRouter>
        </MarketProvider>
      </AuthProvider>
        </CurrencyProvider>
      </I18nProvider>
    </ErrorBoundary>
  );
}
