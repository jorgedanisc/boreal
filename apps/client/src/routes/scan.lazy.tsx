import { createLazyFileRoute } from '@tanstack/react-router'
import { QrScannerPage } from '../pages/QrScannerPage'

export const Route = createLazyFileRoute('/scan')({
  component: QrScannerPage,
})
