// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FollowHudChip } from "../FollowHudChip";
import { useAppStore } from "../../stores/useAppStore";

describe("FollowHudChip", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    useAppStore.setState({
      following: false,
      selectedRunIdx: 42,
    });
  });

  it("renders nothing when following is false", () => {
    const { container } = render(<FollowHudChip />);
    expect(container.firstChild).toBeNull();
  });

  it("renders floating chip when following is true", () => {
    useAppStore.setState({ following: true });
    render(
      <FollowHudChip
        lineName="Sukhumvit Line"
        lineColor="#70BA38"
        trainId={42}
        speedKmh={55}
      />,
    );

    expect(screen.getByText(/Sukhumvit Line #42/)).toBeInTheDocument();
    expect(screen.getByText(/55 km\/h/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /unfollow/i })).toBeInTheDocument();
  });

  it("clicking Unfollow exits follow mode", () => {
    useAppStore.setState({ following: true });
    const onUnfollow = vi.fn();
    render(<FollowHudChip onUnfollow={onUnfollow} />);

    const unfollowBtn = screen.getByRole("button", { name: /unfollow/i });
    fireEvent.click(unfollowBtn);

    expect(onUnfollow).toHaveBeenCalledTimes(1);
  });

  it("clicking Unfollow updates store when onUnfollow is not provided", () => {
    useAppStore.setState({ following: true });
    render(<FollowHudChip />);

    const unfollowBtn = screen.getByRole("button", { name: /unfollow/i });
    fireEvent.click(unfollowBtn);

    expect(useAppStore.getState().following).toBe(false);
  });

  it("supports re-centering camera when onCenter is provided", () => {
    useAppStore.setState({ following: true });
    const onCenter = vi.fn();
    render(<FollowHudChip onCenter={onCenter} />);

    const centerBtn = screen.getByRole("button", { name: /recenter|center camera/i });
    fireEvent.click(centerBtn);

    expect(onCenter).toHaveBeenCalledTimes(1);
  });
});
