-- Enable Safari "Allow unsigned extensions" for local self-signed web extensions.
-- Requires Accessibility permission for the process running osascript (Terminal/Cursor).

on run
  tell application "System Events"
    if not (exists process "Safari") then return
  end tell

  tell application "Safari" to activate
  delay 0.4

  tell application "System Events" to tell process "Safari"
    set frontmost to true

    -- Safari 17+: Developer tab in Settings.
    try
      click menu item "Settings…" of menu "Safari" of menu bar 1
      delay 0.5
      try
        click button "Developer" of toolbar 1 of window 1
      on error
        -- Older Safari: Develop menu item.
        key code 53
        delay 0.2
        click menu item "Allow Unsigned Extensions" of menu "Develop" of menu bar 1
        return
      end try
      delay 0.3
      set devCheckbox to checkbox "Allow unsigned extensions" of group 1 of group 1 of window 1
      if value of devCheckbox is 0 then
        click devCheckbox
      end if
      key code 53
    on error errMsg number errNum
      -- Already enabled or UI changed; ignore.
    end try
  end tell
end run
