import { createRootRoute, Outlet } from '@tanstack/react-router'
import { TitleBar } from '../components/TitleBar'

export const Route = createRootRoute({
  component: () => (
    <div
      id='root-container'
      className="relative h-dvh w-dvw bg-background"

    >
      <TitleBar />
      <Outlet />
    </div >
  ),
})
