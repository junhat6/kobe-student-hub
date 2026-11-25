import { useState, type ReactNode } from 'react';
import { Menu } from '@base-ui/react/menu';
import { Dialog } from '@base-ui/react/dialog';
import Icon from '../shared/Icon';
import './report-menu.css';

/**
 * The 「…」 → 「通報する」 → dialog shape students know from X and YouTube (#228).
 * Reporting is rare, so the page shows only a small menu button instead of a standing form.
 *
 * The dialog body is created on the first 「通報する」 only, so reading stays anonymous until the
 * reader asks to report. After that it stays mounted while closed: an unsent reason survives
 * closing the dialog, and the session boundary inside keeps watching focus and visibility.
 */
export default function ReportMenu({
  subject,
  panelClass,
  children,
}: {
  /** 記事 / 作品 / プロフィール — used in every label. */
  subject: string;
  /** The form's own style scope (report-panel or project-report-panel). */
  panelClass: string;
  /** Renders the report body; call `onSubmitted` after a confirmed new report. */
  children: (onSubmitted: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false),
    [started, setStarted] = useState(false),
    [submitted, setSubmitted] = useState(false);
  return (
    <section className="report-menu" aria-label={`${subject}の通報`}>
      <Menu.Root>
        <Menu.Trigger className="report-menu-trigger" aria-label={`この${subject}のその他の操作`}>
          <Icon name="more" size={20} />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner sideOffset={6} align="end" className="menu-positioner">
            <Menu.Popup className="menu-popup report-menu-popup">
              <Menu.Item
                className="menu-item report-menu-item"
                onClick={() => {
                  setStarted(true);
                  setOpen(true);
                }}
              >
                <Icon name="flag" size={18} />
                通報する
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      {submitted && (
        <p className="report-menu-done" role="status">
          <Icon name="check" size={16} />
          <span>
            通報を
            <wbr />
            受け付けました
          </span>
        </p>
      )}
      {started && (
        <Dialog.Root open={open} onOpenChange={setOpen}>
          <Dialog.Portal keepMounted>
            <Dialog.Backdrop className="report-dialog-backdrop" />
            <Dialog.Popup className={'report-dialog ' + panelClass}>
              <div className="report-dialog-head">
                <Dialog.Title className="report-dialog-title">{subject}の通報</Dialog.Title>
                <Dialog.Close className="report-dialog-close" aria-label="閉じる">
                  <Icon name="close" size={20} />
                </Dialog.Close>
              </div>
              {children(() => {
                setOpen(false);
                setSubmitted(true);
              })}
            </Dialog.Popup>
          </Dialog.Portal>
        </Dialog.Root>
      )}
    </section>
  );
}
