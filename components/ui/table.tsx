import { cn } from "@/lib/utils"
import type { ReactNode } from "react"

interface TableProps {
  children: ReactNode
  className?: string
  striped?: boolean
}

export function Table({ children, className, striped = false }: TableProps) {
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full text-sm", className)}>
        {children}
      </table>
    </div>
  )
}

interface TableHeadProps {
  children: ReactNode
  className?: string
}

export function TableHead({ children, className }: TableHeadProps) {
  return (
    <thead className={cn("bg-muted border-b border-border text-muted-foreground font-semibold", className)}>
      {children}
    </thead>
  )
}

interface TableBodyProps {
  children: ReactNode
  className?: string
}

export function TableBody({ children, className }: TableBodyProps) {
  return (
    <tbody className={cn("divide-y divide-border", className)}>
      {children}
    </tbody>
  )
}

interface TableRowProps {
  children: ReactNode
  className?: string
  striped?: boolean
}

export function TableRow({ children, className, striped }: TableRowProps) {
  return (
    <tr className={cn(
      "hover:bg-muted/50 transition-colors",
      striped && "odd:bg-muted/30",
      className
    )}>
      {children}
    </tr>
  )
}

interface TableCellProps {
  children: ReactNode
  className?: string
  align?: "left" | "center" | "right"
  header?: boolean
}

export function TableCell({ children, className, align = "left", header = false }: TableCellProps) {
  const alignClass = {
    left: "text-left",
    center: "text-center",
    right: "text-right",
  }[align]

  const Element = header ? "th" : "td"

  return (
    <Element className={cn(
      "px-4 py-3",
      alignClass,
      header && "font-semibold text-sm",
      !header && "text-muted-foreground",
      className
    )}>
      {children}
    </Element>
  )
}
