import { AlertTriangle, AlertCircle, CheckCircle, Info } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ReactNode } from "react"

export type AlertType = "success" | "error" | "warning" | "info"

const ALERT_STYLES: Record<AlertType, string> = {
  success: "bg-green-50 border-green-200 text-green-900 dark:bg-green-950 dark:border-green-800 dark:text-green-100",
  error: "bg-red-50 border-red-200 text-red-900 dark:bg-red-950 dark:border-red-800 dark:text-red-100",
  warning: "bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-950 dark:border-amber-800 dark:text-amber-100",
  info: "bg-blue-50 border-blue-200 text-blue-900 dark:bg-blue-950 dark:border-blue-800 dark:text-blue-100",
}

const ALERT_ICONS: Record<AlertType, React.ComponentType<{ className?: string }>> = {
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
}

interface AlertProps {
  type: AlertType
  title?: ReactNode
  message: ReactNode
  icon?: boolean
  className?: string
}

export function Alert({ type = "info", title, message, icon = true, className }: AlertProps) {
  const Icon = ALERT_ICONS[type]

  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-3 flex gap-3",
        ALERT_STYLES[type],
        className
      )}
      role="alert"
    >
      {icon && <Icon className="h-5 w-5 shrink-0 mt-0.5" />}
      <div className="flex-1">
        {title && <h3 className="font-semibold text-sm">{title}</h3>}
        <p className={cn("text-sm", title && "mt-1")}>{message}</p>
      </div>
    </div>
  )
}

/**
 * Convenience component for error messages
 */
export function ErrorAlert({ title, message, className }: {
  title?: ReactNode; message: ReactNode; className?: string
}) {
  return <Alert type="error" title={title} message={message} className={className} />
}

/**
 * Convenience component for success messages
 */
export function SuccessAlert({ title, message, className }: {
  title?: ReactNode; message: ReactNode; className?: string
}) {
  return <Alert type="success" title={title} message={message} className={className} />
}

/**
 * Convenience component for warning messages
 */
export function WarningAlert({ title, message, className }: {
  title?: ReactNode; message: ReactNode; className?: string
}) {
  return <Alert type="warning" title={title} message={message} className={className} />
}

/**
 * Convenience component for info messages
 */
export function InfoAlert({ title, message, className }: {
  title?: ReactNode; message: ReactNode; className?: string
}) {
  return <Alert type="info" title={title} message={message} className={className} />
}
