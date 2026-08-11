'use client'

import {
  OverlayScrollbarsComponent as OriginalOverlayScrollbarsComponent,
  OverlayScrollbarsComponentProps as OriginalOverlayScrollbarsComponentProps,
  OverlayScrollbarsComponentRef,
} from 'overlayscrollbars-react'
import { ForwardedRef, forwardRef } from 'react'

function OverlayScrollbarsComponentInner(
  props: OriginalOverlayScrollbarsComponentProps,
  ref: ForwardedRef<OverlayScrollbarsComponentRef>
) {
  const { children, options: callerOptions, ...otherProps } = props
  const overrides = (callerOptions ?? {}) as Record<string, unknown>
  const mergedOptions = {
    showNativeOverlaidScrollbars: true,
    ...overrides,
    scrollbars: {
      autoHide: 'scroll' as const,
      ...(overrides.scrollbars as object | undefined),
    },
  }
  return (
    <OriginalOverlayScrollbarsComponent ref={ref} {...otherProps} options={mergedOptions} defer>
      {children}
    </OriginalOverlayScrollbarsComponent>
  )
}

export const OverlayScrollbarsComponent = forwardRef(OverlayScrollbarsComponentInner)
