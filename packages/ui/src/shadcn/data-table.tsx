"use client";

import type {
  HTMLAttributes,
  ReactNode,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from "react";
import { cn } from "./cn";

/**
 * DataTable — lightweight token-styled table primitives (doc 04 deliverable).
 * Intentionally NOT a `@tanstack/table` island: for the trade demo the
 * high-frequency data panels stay SSR + token CSS (doc 04 §3.2), so this is a
 * thin styled-`<table>` set for the low-frequency tabular chrome that does live
 * in an island (e.g. settings tables, history views). Token-backed only.
 *
 * A tiny `DataTable<T>` convenience renders header + rows from a column spec
 * for the common case; the primitive parts (`Table`, `TableRow`, ...) remain
 * exported for hand-composed layouts.
 */

function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-auto">
      <table
        className={cn(
          "w-full caption-bottom border-collapse text-sm text-ink",
          className,
        )}
        {...props}
      />
    </div>
  );
}

function TableHeader({
  className,
  ...props
}: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn("border-b border-border text-text-muted", className)}
      {...props}
    />
  );
}

function TableBody({
  className,
  ...props
}: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn(className)} {...props} />;
}

function TableRow({
  className,
  ...props
}: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        "border-b border-border transition-colors hover:bg-surface-1 data-[state=selected]:bg-surface-1",
        className,
      )}
      {...props}
    />
  );
}

function TableHead({
  className,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        "h-9 px-md text-left align-middle font-medium text-text-muted",
        className,
      )}
      {...props}
    />
  );
}

function TableCell({
  className,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn("px-md py-xs align-middle text-ink", className)}
      {...props}
    />
  );
}

export type DataTableColumn<T> = {
  /** Stable key; also used to read `row[key]` when `cell` is omitted. */
  key: string;
  /** Column header content. */
  header: ReactNode;
  /** Optional custom cell renderer; defaults to `String(row[key])`. */
  cell?: (row: T) => ReactNode;
  /** Optional extra token classes for this column's cells. */
  className?: string;
};

export type DataTableProps<T> = {
  columns: DataTableColumn<T>[];
  rows: T[];
  /** Row identity for React keys; defaults to array index. */
  getRowId?: (row: T, index: number) => string;
  className?: string;
};

function DataTable<T extends Record<string, unknown>>({
  columns,
  rows,
  getRowId,
  className,
}: DataTableProps<T>) {
  return (
    <Table className={className}>
      <TableHeader>
        <TableRow>
          {columns.map((column) => (
            <TableHead key={column.key} className={column.className}>
              {column.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, index) => (
          <TableRow key={getRowId ? getRowId(row, index) : String(index)}>
            {columns.map((column) => (
              <TableCell key={column.key} className={column.className}>
                {column.cell ? column.cell(row) : String(row[column.key] ?? "")}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export {
  DataTable,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
};
