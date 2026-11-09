import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { DataProvider } from './store';
import { AuthProvider, useAuth } from './auth';
import { ToastProvider } from './components/Toasts';
import { ConfirmProvider } from './components/Confirm';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Welcome } from './components/Welcome';
import './styles.css';
import './welcome.css';

/** Shows the welcome screen until someone is signed in (account or guest). */
function Gate() {
  const { status, user, upgrading } = useAuth();
  if (status === 'loading') return <div className="welcome" aria-busy="true" />;
  if (status === 'signedOut' || !user) return <Welcome />;
  return (
    <>
      {/* Keyed by user (and guest→account) so data always reloads for whoever is signed in. */}
      <DataProvider key={`${user.id}:${user.isGuest}`}>
        <App />
      </DataProvider>
      {upgrading && (
        <div className="welcome-overlay">
          <Welcome />
        </div>
      )}
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <ConfirmProvider>
          <AuthProvider>
            <Gate />
          </AuthProvider>
        </ConfirmProvider>
      </ToastProvider>
    </ErrorBoundary>
  </StrictMode>,
);
