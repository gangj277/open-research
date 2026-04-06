import React from "react";
import { describe, expect, test } from "vitest";
import { render } from "ink-testing-library";
import TextInput from "@/tui/text-input";

describe("TextInput burst input handling", () => {
  test("preserves all fragments written back-to-back", async () => {
    function Wrapper() {
      const [value, setValue] = React.useState("");
      return <TextInput value={value} onChange={setValue} focus showCursor />;
    }

    const { stdin, lastFrame, unmount } = render(<Wrapper />);

    stdin.write("beginning ");
    stdin.write("middle ");
    stdin.write("end");

    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(lastFrame()).toContain("beginning middle end");
    unmount();
  });

  test("submits the full bracketed paste when content arrives in multiple fragments", async () => {
    let submitted = "";

    function Wrapper() {
      const [value, setValue] = React.useState("");
      return (
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={(value) => {
            submitted = value;
          }}
          focus
          showCursor
        />
      );
    }

    const { stdin, unmount } = render(<Wrapper />);

    stdin.write("\u001b[200~First line of pasted text. ");
    stdin.write("Second chunk continues here.\nThird line.\nFourth line.");
    stdin.write("\u001b[201~");

    await new Promise((resolve) => setTimeout(resolve, 25));

    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(submitted).toBe(
      "First line of pasted text. Second chunk continues here.\nThird line.\nFourth line."
    );
    unmount();
  });

  test("renders one paste badge for a fragmented bracketed multi-line paste", async () => {
    function Wrapper() {
      const [value, setValue] = React.useState("");
      return <TextInput value={value} onChange={setValue} focus showCursor />;
    }

    const { stdin, lastFrame, unmount } = render(<Wrapper />, {
      stdout: { columns: 160 },
    });

    stdin.write("\u001b[200~/quit");
    stdin.write("\n! bun install -g open-research@latest");
    stdin.write("\nopen-research ready output\u001b[201~");

    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(lastFrame()).not.toContain("/quit");
    expect(lastFrame()).toContain("[Pasted text #1 +2 lines]");
    unmount();
  });
});
