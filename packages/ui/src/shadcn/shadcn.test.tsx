import {
  ComponentMetadataSchema,
  PerformanceBudgetSchema,
} from "@mvp/contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  cn,
  DataTable,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  dialogBudget,
  dialogMetadata,
  LocaleSwitcher,
  localeSwitcherMetadata,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  ThemeToggle,
  Toast,
  ToastProvider,
  ToastTitle,
  ToastViewport,
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
  themeToggleMetadata,
} from "./index";

describe("@mvp/ui shadcn — cn convention", () => {
  it("merges conditional classes and lets later token utilities win", () => {
    // clsx conditional + object inputs resolve, tailwind-merge de-dupes the
    // conflicting background so the override wins.
    expect(cn("bg-surface-1", false && "hidden", ["text-ink"])).toBe(
      "bg-surface-1 text-ink",
    );
    expect(cn("bg-surface-1", "bg-surface-2")).toBe("bg-surface-2");
  });

  it("emits only token-backed classes (no hard-coded colors)", () => {
    const className = cn("bg-surface-2 text-ink border-border");
    expect(className).not.toMatch(/#[0-9a-f]{3,6}/i);
    expect(className).not.toMatch(/\b(?:bg|text)-\[/); // no arbitrary color values
  });
});

describe("@mvp/ui shadcn — render", () => {
  it("renders a Dialog and opens it on trigger click", () => {
    render(
      <Dialog>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent>
          <DialogTitle>Connect wallet</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.queryByText("Connect wallet")).toBeNull();
    fireEvent.click(screen.getByText("Open"));
    expect(screen.getByText("Connect wallet")).toBeTruthy();
  });

  it("switches Tabs on trigger click (onValueChange + active panel)", () => {
    const onValueChange = vi.fn();
    // Controlled harness: Radix Tabs activates a trigger on click and calls
    // onValueChange; the harness re-renders with the new value so the active
    // panel's `hidden` attribute flips. This exercises real interaction wiring
    // without relying on Radix's internal roving-focus in happy-dom.
    function Harness() {
      const [value, setValue] = useState("positions");
      return (
        <Tabs
          value={value}
          onValueChange={(next) => {
            onValueChange(next);
            setValue(next);
          }}
        >
          <TabsList>
            <TabsTrigger value="positions">Positions</TabsTrigger>
            <TabsTrigger value="orders">Orders</TabsTrigger>
          </TabsList>
          <TabsContent value="positions">Positions body</TabsContent>
          <TabsContent value="orders">Orders body</TabsContent>
        </Tabs>
      );
    }
    render(<Harness />);
    const ordersTab = screen.getByRole("tab", { name: "Orders" });
    expect(ordersTab.getAttribute("data-state")).toBe("inactive");
    // Radix Tabs activates on pointer/mouse down (not the click event).
    fireEvent.pointerDown(ordersTab, { button: 0, ctrlKey: false });
    fireEvent.mouseDown(ordersTab, { button: 0, ctrlKey: false });
    expect(onValueChange).toHaveBeenCalledWith("orders");
    expect(
      screen.getByRole("tab", { name: "Orders" }).getAttribute("data-state"),
    ).toBe("active");
  });

  it("renders a Tooltip trigger", () => {
    render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>Funding</TooltipTrigger>
        </Tooltip>
      </TooltipProvider>,
    );
    expect(screen.getByText("Funding")).toBeTruthy();
  });

  it("renders a Slider and moves on keyboard arrow", () => {
    const onValueChange = vi.fn();
    render(
      <Slider
        defaultValue={[10]}
        min={0}
        max={100}
        step={1}
        onValueChange={onValueChange}
      />,
    );
    const thumb = screen.getByRole("slider");
    thumb.focus();
    fireEvent.keyDown(thumb, { key: "ArrowRight" });
    expect(onValueChange).toHaveBeenCalled();
  });

  it("renders a Toast inside its provider", () => {
    render(
      <ToastProvider>
        <Toast open variant="success">
          <ToastTitle>Order filled</ToastTitle>
        </Toast>
        <ToastViewport />
      </ToastProvider>,
    );
    expect(screen.getByText("Order filled")).toBeTruthy();
  });

  it("filters Command items by input", () => {
    render(
      <Command>
        <CommandInput placeholder="Search" />
        <CommandList>
          <CommandEmpty>No results</CommandEmpty>
          <CommandGroup heading="Symbols">
            <CommandItem value="btc">BTC-USD</CommandItem>
            <CommandItem value="eth">ETH-USD</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>,
    );
    expect(screen.getByText("BTC-USD")).toBeTruthy();
    expect(screen.getByText("ETH-USD")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Search"), {
      target: { value: "btc" },
    });
    expect(screen.getByText("BTC-USD")).toBeTruthy();
    expect(screen.queryByText("ETH-USD")).toBeNull();
  });

  it("renders open DropdownMenu content (controlled)", () => {
    // Radix menus open via a pointer-capture sequence happy-dom does not fully
    // emulate, so drive `open` directly to verify the token-styled content and
    // item render through the portal.
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>Wallet</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Disconnect</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(screen.getByText("Wallet")).toBeTruthy();
    expect(screen.getByText("Disconnect")).toBeTruthy();
  });

  it("renders a Select trigger with its value", () => {
    render(
      <Select defaultValue="1m">
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="1m">1m</SelectItem>
          <SelectItem value="5m">5m</SelectItem>
        </SelectContent>
      </Select>,
    );
    expect(screen.getByText("1m")).toBeTruthy();
  });

  it("renders a DataTable from a column spec", () => {
    render(
      <DataTable
        columns={[
          { key: "symbol", header: "Symbol" },
          { key: "price", header: "Price", cell: (row) => `$${row.price}` },
        ]}
        rows={[{ symbol: "BTC", price: 65000 }]}
      />,
    );
    expect(screen.getByText("Symbol")).toBeTruthy();
    expect(screen.getByText("BTC")).toBeTruthy();
    expect(screen.getByText("$65000")).toBeTruthy();
  });
});

describe("@mvp/ui shadcn — token demo components", () => {
  it("ThemeToggle fires onThemeChange with the next theme", () => {
    const onThemeChange = vi.fn();
    render(<ThemeToggle theme="light" onThemeChange={onThemeChange} />);
    const dark = screen.getByRole("button", { name: "dark" });
    expect(dark.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(dark);
    expect(onThemeChange).toHaveBeenCalledWith("dark");
  });

  it("ThemeToggle reflects the controlled theme", () => {
    function Harness() {
      const [theme, setTheme] = useState<"light" | "dark">("light");
      return <ThemeToggle theme={theme} onThemeChange={setTheme} />;
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "dark" }));
    expect(
      screen.getByRole("button", { name: "dark" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("LocaleSwitcher renders the selected locale label", () => {
    const onLocaleChange = vi.fn();
    render(
      <LocaleSwitcher
        locale="en"
        options={[
          { value: "en", label: "English" },
          { value: "zh-CN", label: "简体中文" },
        ]}
        onLocaleChange={onLocaleChange}
      />,
    );
    expect(screen.getByText("English")).toBeTruthy();
  });
});

describe("@mvp/ui shadcn — metadata contracts", () => {
  it("marks island primitives as not server-safe", () => {
    for (const item of [
      dialogMetadata,
      themeToggleMetadata,
      localeSwitcherMetadata,
    ]) {
      expect(ComponentMetadataSchema.parse(item).serverSafe).toBe(false);
      expect(item.category).toBe("island");
    }
  });

  it("validates island budgets at component scope", () => {
    expect(PerformanceBudgetSchema.parse(dialogBudget).scope).toBe("component");
  });
});
