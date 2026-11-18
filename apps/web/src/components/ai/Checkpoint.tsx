import {useState} from 'react';
import type {Checkpoint as CheckpointRecord, TurnEvent} from '@/lib/agent/types';
import * as stylex from '@stylexjs/stylex';
import {AlertDialog} from '@astryxdesign/core/AlertDialog';
import {Button} from '@astryxdesign/core/Button';
import {ChatSystemMessage} from '@astryxdesign/core/Chat';
import {HStack} from '@astryxdesign/core/Layout';
import {Text} from '@astryxdesign/core/Text';
import {Timestamp} from '@astryxdesign/core/Timestamp';

const styles = stylex.create({
  dialog: {boxShadow: 'none'},
});

type CheckpointProps = {
  checkpoint: CheckpointRecord;
  onEvent(event: TurnEvent): void | Promise<void>;
};

export function Checkpoint({checkpoint, onEvent}: CheckpointProps) {
  const [isConfirming, setIsConfirming] = useState(false);
  const [isKept, setIsKept] = useState(false);
  const keep = () => {
    setIsKept(true);
    // A failed keep brings the button back so it can be retried.
    Promise.resolve(onEvent({type: 'keep', turnId: checkpoint.turnId, at: new Date().toISOString()})).catch(() => setIsKept(false));
  };
  const restore = () => {
    setIsConfirming(false);
    onEvent({type: 'restore', turnId: checkpoint.turnId, checkpointId: checkpoint.id, at: new Date().toISOString()});
  };

  return (
    <ChatSystemMessage>
      <HStack gap={2} align="center">
        <Text type="supporting" color="secondary">
          Checkpoint
        </Text>
        <Timestamp value={checkpoint.createdAt} type="supporting" />
        {isKept ? (
          <Text type="supporting" color="secondary" role="status">
            Kept
          </Text>
        ) : (
          <Button label="Keep" variant="ghost" size="sm" onClick={keep} />
        )}
        <Button label="Restore" variant="ghost" size="sm" onClick={() => setIsConfirming(true)} />
      </HStack>
      <AlertDialog
        isOpen={isConfirming}
        onOpenChange={setIsConfirming}
        title="Restore this checkpoint?"
        description="Your app goes back to how it was at this point. Changes made after it are undone."
        cancelLabel="Cancel"
        actionLabel="Restore"
        actionVariant="destructive"
        onAction={restore}
        xstyle={styles.dialog}
      />
    </ChatSystemMessage>
  );
}
