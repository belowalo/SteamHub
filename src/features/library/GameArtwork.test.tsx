import { render, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { GameArtwork } from "./GameArtwork";
describe("library artwork", () => {
  it("loads Steam artwork lazily and falls back without broken-image loops", () => {
    const { container, rerender } = render(<GameArtwork appId="813780" />);
    const first = container.querySelector("img")!;
    expect(first).toHaveAttribute("loading", "lazy");
    expect(first.src).toContain(
      "/store_item_assets/steam/apps/813780/header.jpg",
    );
    fireEvent.error(first);
    expect(container.querySelector("img")!.src).toContain(
      ".com/steam/apps/813780/header.jpg",
    );
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
    rerender(<GameArtwork appId="620" />);
    expect(container.querySelector("img")!.src).toContain("/620/header.jpg");
  });
});
