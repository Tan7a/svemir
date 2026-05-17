import type { ChannelWithBlocks } from "@/lib/types";
import ChannelCard from "./ChannelCard";

type Props = {
  channels: ChannelWithBlocks[];
};

/**
 * Vertical stack of horizontal ChannelCard rows.
 */
export default function ChannelsView({ channels }: Props) {
  if (channels.length === 0) {
    return (
      <div className="px-5 py-12 text-sm text-neutral-500">
        No channels yet. Channels come from the folder names in your imported
        Chrome bookmarks, or you can create one from /admin.
      </div>
    );
  }
  return (
    <div className="space-y-0 px-5 pb-16">
      {channels.map((c) => (
        <ChannelCard key={c.id} channel={c} />
      ))}
    </div>
  );
}
