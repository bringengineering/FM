import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import FleetPhotoCapture from "../../app/fleet/FleetPhotoCapture";

function Harness() {
  const [file, setFile] = useState<File>();
  return <FleetPhotoCapture file={file} onChange={setFile} />;
}

describe("FleetPhotoCapture", () => {
  it("opens the rear camera and requires an odometer image", () => {
    render(<Harness />);
    const input = screen.getByLabelText("계기판 사진 촬영") as HTMLInputElement;

    expect(input.required).toBe(true);
    expect(input.accept).toBe("image/jpeg,image/png,image/webp");
    expect(input.getAttribute("capture")).toBe("environment");
  });

  it("shows a preview and supports retaking the image", () => {
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    render(<Harness />);
    const input = screen.getByLabelText("계기판 사진 촬영") as HTMLInputElement;
    const file = new File([new Uint8Array([1])], "odometer.jpg", { type: "image/jpeg" });

    fireEvent.change(input, { target: { files: [file] } });
    expect(screen.getByRole("img", { name: "촬영한 계기판 미리보기" })).toHaveAttribute("src", "blob:preview");
    fireEvent.click(screen.getByRole("button", { name: "다시 촬영" }));
    expect(screen.queryByRole("img", { name: "촬영한 계기판 미리보기" })).not.toBeInTheDocument();

    expect(createObjectURL).toHaveBeenCalledWith(file);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:preview");
  });
});
