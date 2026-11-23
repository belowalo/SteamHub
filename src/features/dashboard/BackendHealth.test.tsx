import { afterEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { clearMocks } from "@tauri-apps/api/mocks";
import { mockIPC } from "@/test/desktop";
import { BackendHealth } from "./BackendHealth";

afterEach(() => {
  clearMocks();
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  Reflect.deleteProperty(globalThis, "isTauri");
});

describe("foundation health regression", () => {
  it("shows real health, then permits a new check", async () => {
    let calls = 0;
    mockIPC(() => {
      calls += 1;
      return {
        ok: true,
        data: { apiVersion: 1, databaseReady: true, appVersion: "0.1.0" },
      };
    });
    render(<BackendHealth />);
    expect(screen.getByTestId("health-status")).toHaveTextContent("Checking");
    await waitFor(() =>
      expect(screen.getByTestId("health-status")).toHaveTextContent(
        "Connected",
      ),
    );
    expect(screen.getByTestId("database-status")).toHaveTextContent("Ready");
    await userEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(calls).toBe(2));
  });

  it("does not advertise database readiness when the backend cannot verify it", async () => {
    mockIPC(() => ({
      ok: true,
      data: { apiVersion: 1, databaseReady: false, appVersion: "0.1.0" },
    }));
    render(<BackendHealth />);
    await waitFor(() =>
      expect(screen.getByTestId("database-status")).toHaveTextContent(
        "Unverified",
      ),
    );
    expect(screen.getByTestId("health-status")).toHaveTextContent(
      "Unavailable",
    );
    expect(screen.getByTestId("bridge-status")).toHaveTextContent("Connected");
  });

  it("can recover from a backend error through the retry control", async () => {
    let calls = 0;
    mockIPC(() =>
      ++calls === 1
        ? {
            ok: false,
            error: {
              code: "INTERNAL",
              message: "Database check failed",
              retryable: true,
            },
          }
        : {
            ok: true,
            data: { apiVersion: 1, databaseReady: true, appVersion: "0.1.0" },
          },
    );
    render(<BackendHealth />);
    expect(
      await screen.findByText("Database check failed"),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() =>
      expect(screen.getByTestId("database-status")).toHaveTextContent("Ready"),
    );
  });

  it("clearly labels browser preview", async () => {
    render(<BackendHealth />);
    expect(
      await screen.findByText(/Desktop backend unavailable/),
    ).toBeInTheDocument();
  });
});
