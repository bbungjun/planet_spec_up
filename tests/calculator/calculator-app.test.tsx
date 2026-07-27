import { render, screen } from "@testing-library/react";
import Page from "@/app/page";

it("renders the Planet Lab calculator entry point", () => {
  render(<Page />);
  expect(
    screen.getByRole("heading", { name: "플래닛 데미지 계산기" }),
  ).toBeInTheDocument();
});
