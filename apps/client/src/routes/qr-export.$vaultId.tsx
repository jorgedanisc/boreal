import { createFileRoute } from '@tanstack/react-router';
import { QrExportPage } from '@/pages/QrExportPage';

export const Route = createFileRoute('/qr-export/$vaultId')({
  component: QrExportPage,
});
