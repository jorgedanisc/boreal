import { createFileRoute } from '@tanstack/react-router'
import { QrScannerPage } from '../pages/QrScannerPage'

export const Route = createFileRoute('/scan')({
  component: QrScannerPage,
})
