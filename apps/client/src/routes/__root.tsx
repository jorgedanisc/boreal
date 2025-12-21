import { createRootRoute, Outlet } from '@tanstack/react-router'
import { TitleBar } from '../components/TitleBar'

export const Route = createRootRoute({
  component: () => (
    <div
      id='root-container'
      className="relative h-dvh w-dvw bg-background"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
    >
      <TitleBar />
      <Outlet />
    </div>
  ),
})
