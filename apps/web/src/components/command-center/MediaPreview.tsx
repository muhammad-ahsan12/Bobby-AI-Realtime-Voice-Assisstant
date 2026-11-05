import { motion, useReducedMotion } from 'motion/react';
import { X } from 'lucide-react';
import { LocalVideoTrack, Track } from 'livekit-client';
import { useEffect, useRef } from 'react';
import type { Room } from 'livekit-client';

interface MediaPreviewProps {
  room: Room;
  source: 'camera' | 'screen';
  label: string;
  onStop: () => void;
}

export function MediaPreview({ room, source, label, onStop }: MediaPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const reducedMotion = useReducedMotion();
  const trackSource = source === 'camera' ? Track.Source.Camera : Track.Source.ScreenShare;

  useEffect(() => {
    const video = videoRef.current;
    const track = room.localParticipant.getTrackPublication(trackSource)?.track;
    if (!video || !(track instanceof LocalVideoTrack)) return;
    const attachedVideo = track.attach(video);
    return () => {
      track.detach(attachedVideo);
    };
  }, [room, trackSource]);

  return (
    <motion.figure
      className={`media-preview ${source === 'camera' ? 'camera-preview' : 'screen-preview'}`}
      drag
      dragMomentum={false}
      dragElastic={0.06}
      initial={reducedMotion ? false : { opacity: 0, scale: 0.88, y: -8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: reducedMotion ? 0 : 0.22 }}
    >
      <video ref={videoRef} autoPlay muted playsInline />
      <figcaption>
        <span className="media-live-indicator" />
        {label}
      </figcaption>
      <span className="preview-resize-corner" aria-hidden="true" />
      <span className="preview-grab-hint" aria-hidden="true">DRAG TO MOVE</span>
      <button
        type="button"
        className="preview-close"
        aria-label={`Stop ${label.toLowerCase()}`}
        onClick={(event) => {
          event.stopPropagation();
          onStop();
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <X aria-hidden="true" />
      </button>
    </motion.figure>
  );
}
