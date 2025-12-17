import { cn } from "@/lib/utils"
import { IconLoader, type IconProps } from "@tabler/icons-react"

function Spinner({ className, ...props }: IconProps) {
  return (
    <IconLoader role="status" aria-label="Loading" className={cn("size-4 animate-spin", className)} {...props} />
  )
}

export { Spinner }
