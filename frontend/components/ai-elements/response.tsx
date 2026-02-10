import * as React from "react"
import { cn } from "@/lib/utils"
import { renderMarkdown } from "@/lib/markdown-renderer"

type ResponseProps = React.HTMLAttributes<HTMLDivElement> & {
  children: string
}

const Response = React.forwardRef<HTMLDivElement, ResponseProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "prose prose-sm dark:prose-invert max-w-none leading-7 prose-headings:font-semibold prose-p:my-2 prose-pre:rounded-xl prose-pre:border prose-pre:border-border/70 prose-pre:bg-background prose-pre:text-foreground prose-code:text-foreground",
          className
        )}
        dangerouslySetInnerHTML={{ __html: renderMarkdown(children).html }}
        {...props}
      />
    )
  }
)

Response.displayName = "Response"

export { Response }
