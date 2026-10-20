import AdminPage from './admin-page';

export const metadata = { robots: { index: false, follow: false } };

export default function PrivateControlCenterPage() {
  return <AdminPage />;
}
