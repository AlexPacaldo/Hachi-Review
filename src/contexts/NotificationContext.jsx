import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  ACCOUNT_DATA_CHANGED_EVENT,
  getNotificationHistory,
  REVIEWER_DATA_CHANGED_EVENT,
  saveNotificationHistory
} from "../utils/storageUtils.js";

const NotificationContext = createContext(null);
const MAX_NOTIFICATIONS = 25;
const TOAST_DURATION = 5200;

function readNotifications() {
  return getNotificationHistory().slice(0, MAX_NOTIFICATIONS);
}

// The store is the record, and it changes hands with the account. Comparing
// before setting keeps a progress save, which fires the reviewer event every few
// seconds during a quiz, from re-rendering every notification consumer.
function sameNotifications(current, next) {
  return current.length === next.length
    && current.every((item, index) => item.id === next[index]?.id && item.read === next[index]?.read);
}

function createNotification(notification) {
  return {
    id: notification.id || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`),
    type: notification.type || "info",
    title: notification.title || "Hachi",
    message: notification.message || "",
    createdAt: notification.createdAt || new Date().toISOString(),
    read: Boolean(notification.read),
    actionLabel: notification.actionLabel || "",
    actionHref: notification.actionHref || "",
    actions: Array.isArray(notification.actions) ? notification.actions : []
  };
}

export function NotificationProvider({ children }) {
  const [notifications, setNotifications] = useState(readNotifications);
  const [toastIds, setToastIds] = useState([]);
  const actionHandlers = useRef(new Map());

  useEffect(() => {
    saveNotificationHistory(notifications.slice(0, MAX_NOTIFICATIONS));
  }, [notifications]);

  // A different account, or a wipe of the device data, both replace the history
  // behind this list. The account event covers the sign-in and sign-out; the
  // reviewer event covers the wipe, which no account change announces.
  useEffect(() => {
    const handleStoreChange = () => {
      setNotifications((current) => {
        const next = readNotifications();
        return sameNotifications(current, next) ? current : next;
      });
    };

    window.addEventListener(ACCOUNT_DATA_CHANGED_EVENT, handleStoreChange);
    window.addEventListener(REVIEWER_DATA_CHANGED_EVENT, handleStoreChange);
    return () => {
      window.removeEventListener(ACCOUNT_DATA_CHANGED_EVENT, handleStoreChange);
      window.removeEventListener(REVIEWER_DATA_CHANGED_EVENT, handleStoreChange);
    };
  }, []);

  const registerAction = useCallback((kind, handler) => {
    actionHandlers.current.set(kind, handler);
    return () => {
      actionHandlers.current.delete(kind);
    };
  }, []);

  const executeAction = useCallback(async (kind, payload) => {
    const handler = actionHandlers.current.get(kind);
    if (!handler) throw new Error(`No action handler registered for "${kind}".`);
    await handler(payload);
  }, []);

  const dismissToast = useCallback((id) => {
    setToastIds((current) => current.filter((toastId) => toastId !== id));
  }, []);

  const notify = useCallback(
    (notification) => {
      const nextNotification = createNotification(notification);
      setNotifications((current) => [nextNotification, ...current.filter((item) => item.id !== nextNotification.id)].slice(0, MAX_NOTIFICATIONS));
      setToastIds((current) => [nextNotification.id, ...current.filter((id) => id !== nextNotification.id)].slice(0, 3));

      window.setTimeout(() => dismissToast(nextNotification.id), notification.duration || TOAST_DURATION);
      return nextNotification.id;
    },
    [dismissToast]
  );

  useEffect(() => {
    const handleNotifyEvent = (event) => {
      if (!event.detail) return;
      notify(event.detail);
    };

    window.addEventListener("hachi:notify", handleNotifyEvent);
    return () => window.removeEventListener("hachi:notify", handleNotifyEvent);
  }, [notify]);

  const markAllRead = useCallback(() => {
    setNotifications((current) => current.map((notification) => ({ ...notification, read: true })));
  }, []);

  const markRead = useCallback((id) => {
    setNotifications((current) => current.map((notification) => (notification.id === id ? { ...notification, read: true } : notification)));
  }, []);

  const removeNotification = useCallback((id) => {
    setNotifications((current) => current.filter((notification) => notification.id !== id));
    dismissToast(id);
  }, [dismissToast]);

  const clearNotifications = useCallback(() => {
    setNotifications([]);
    setToastIds([]);
  }, []);

  const value = useMemo(
    () => ({
      notifications,
      toastNotifications: toastIds.map((id) => notifications.find((notification) => notification.id === id)).filter(Boolean),
      unreadCount: notifications.filter((notification) => !notification.read).length,
      notify,
      registerAction,
      executeAction,
      markAllRead,
      markRead,
      removeNotification,
      clearNotifications,
      dismissToast
    }),
    [clearNotifications, dismissToast, executeAction, markAllRead, markRead, notify, registerAction, removeNotification, toastIds]
  );

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error("useNotifications must be used inside NotificationProvider.");
  }
  return context;
}
