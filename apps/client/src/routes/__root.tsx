import { createRootRoute, Outlet } from '@tanstack/react-router'
import { TitleBar } from '../components/TitleBar'
import { Toaster } from 'sonner'

export const Route = createRootRoute({
  component: () => (
    <div
      id='root-container'
      className="relative h-dvh w-dvw bg-background"

    >
      <TitleBar />
      <Outlet />
      <Toaster richColors position="bottom-center" />
    </div >
  ),
})
