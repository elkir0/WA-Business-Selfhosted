import { LocationProvider, Router, Route } from 'preact-iso';
import { ErrorBoundary } from './components/ErrorBoundary.jsx';
import { Layout } from './components/Layout.jsx';
import { Dashboard } from './pages/Dashboard.jsx';
import { Conversations } from './pages/Conversations.jsx';
import { ConversationDetail } from './pages/ConversationDetail.jsx';
import { Contacts } from './pages/Contacts.jsx';
import { FailedForwards } from './pages/FailedForwards.jsx';
import { System } from './pages/System.jsx';
import { Audit } from './pages/Audit.jsx';

export function App() {
  return (
    <ErrorBoundary>
    <LocationProvider>
      <Layout>
        <Router>
          <Route path="/admin"                          component={Dashboard} />
          <Route path="/admin/"                         component={Dashboard} />
          <Route path="/admin/conversations"            component={Conversations} />
          <Route path="/admin/conversations/:id"        component={ConversationDetail} />
          <Route path="/admin/contacts"                 component={Contacts} />
          <Route path="/admin/forwards"                 component={FailedForwards} />
          <Route path="/admin/system"                   component={System} />
          <Route path="/admin/audit"                    component={Audit} />
          <Route default                                component={NotFound} />
        </Router>
      </Layout>
    </LocationProvider>
    </ErrorBoundary>
  );
}

function NotFound() {
  return (
    <div className="text-center py-16">
      <h1 className="text-3xl font-semibold text-slate-300 dark:text-slate-700 mb-2">404</h1>
      <p className="text-slate-500 mb-6">No page at this URL.</p>
      <a href="/admin" className="text-sky-600 hover:underline">← Back to dashboard</a>
    </div>
  );
}
