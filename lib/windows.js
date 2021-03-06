/* eslint-disable new-cap */
'use strict';
const path = require('path');
const ffi = require('ffi-napi');
const wchar = require('ref-wchar-napi');
const ref = require('ref-napi');
const struct = require('ref-struct-napi');

console.log(path)
console.log(ffi)
console.log(wchar)
console.log(ref)
console.log(struct)

// Create the struct required to save the window bounds
const Rect = struct({
	left: 'long',
	top: 'long',
	right: 'long',
	bottom: 'long'
});

var lpctstr = {
    name: 'lpctstr',
    indirection: 1,
    size: ref.sizeof.pointer,
    get: function(buffer, offset) {
        var _buf = buffer.readPointer(offset);
        if(_buf.isNull()) {
            return null;
        }
        return _buf.readCString(0);
    },
    set: function(buffer, offset, value) {
        var _buf = ref.allocCString(value, 'ucs2');

        return buffer.writePointer(_buf, offset);
    },
    ffi_type: ffi.types.CString.ffi_type
};


const RectPointer = ref.refType(Rect);

// Required by QueryFullProcessImageName
// https://msdn.microsoft.com/en-us/library/windows/desktop/ms684880(v=vs.85).aspx
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

const  UIA_EditControlTypeId = 0xC354;

// Create FFI declarations for the C++ library and functions needed (User32.dll), using their "Unicode" (UTF-16) version
const user32 = new ffi.Library('User32.dll', {
	// https://msdn.microsoft.com/en-us/library/windows/desktop/ms633505(v=vs.85).aspx
	GetForegroundWindow: ['pointer', []],
	// https://msdn.microsoft.com/en-us/library/windows/desktop/ms633520(v=vs.85).aspx
	GetWindowTextW: ['int', ['pointer', 'pointer', 'int']],
	// https://msdn.microsoft.com/en-us/library/windows/desktop/ms633521(v=vs.85).aspx
	GetWindowTextLengthW: ['int', ['pointer']],
	// https://msdn.microsoft.com/en-us/library/windows/desktop/ms633522(v=vs.85).aspx
	GetWindowThreadProcessId: ['uint32', ['pointer', 'uint32 *']],
	// Get window bounds function
	// https://docs.microsoft.com/en-us/windows/desktop/api/winuser/nf-winuser-getwindowrect
	GetWindowRect: ['bool', ['pointer', RectPointer]],

	FindWindowExA: ['pointer', ['pointer', 'pointer', lpctstr, lpctstr]]
});


console.log("user32", user32)

const SIZE_T = 'uint64';

// https://docs.microsoft.com/en-us/windows/desktop/api/psapi/ns-psapi-_process_memory_counters
const ProcessMemoryCounters = struct({
	cb: 'uint32',
	PageFaultCount: 'uint32',
	PeakWorkingSetSize: SIZE_T,
	WorkingSetSize: SIZE_T,
	QuotaPeakPagedPoolUsage: SIZE_T,
	QuotaPagedPoolUsage: SIZE_T,
	QuotaPeakNonPagedPoolUsage: SIZE_T,
	QuotaNonPagedPoolUsage: SIZE_T,
	PagefileUsage: SIZE_T,
	PeakPagefileUsage: SIZE_T
});

const ProcessMemoryCountersPointer = ref.refType(ProcessMemoryCounters);

// Create FFI declarations for the C++ library and functions needed (psapi.dll)
const psapi = new ffi.Library('psapi', {
	// https://docs.microsoft.com/en-us/windows/desktop/api/psapi/nf-psapi-getprocessmemoryinfo
	GetProcessMemoryInfo: ['int', ['pointer', ProcessMemoryCountersPointer, 'uint32']]
});

// Create FFI declarations for the C++ library and functions needed (Kernel32.dll), using their "Unicode" (UTF-16) version
const kernel32 = new ffi.Library('kernel32', {
	// https://msdn.microsoft.com/en-us/library/windows/desktop/ms684320(v=vs.85).aspx
	OpenProcess: ['pointer', ['uint32', 'int', 'uint32']],
	// https://msdn.microsoft.com/en-us/library/windows/desktop/ms724211(v=vs.85).aspx
	CloseHandle: ['int', ['pointer']],
	// https://msdn.microsoft.com/en-us/library/windows/desktop/ms684919(v=vs.85).aspx
	QueryFullProcessImageNameW: ['int', ['pointer', 'uint32', 'pointer', 'pointer']]
});

function windows() {
	// Windows C++ APIs' functions are declared with capitals, so this rule has to be turned off

	// Get a "handle" of the active window
	const activeWindowHandle = user32.GetForegroundWindow();

	console.log("activeWindow", activeWindowHandle)

	const windowId = ref.address(activeWindowHandle);
	// Get the window text length in "characters" to create the buffer
	const windowTextLength = user32.GetWindowTextLengthW(activeWindowHandle);
	// Allocate a buffer large enough to hold the window text as "Unicode" (UTF-16) characters (using ref-wchar-napi)
	// This assumes using the "Basic Multilingual Plane" of Unicode, only 2 characters per Unicode code point
	// Include some extra bytes for possible null characters
	const windowTextBuffer = Buffer.alloc((windowTextLength * 2) + 4);

	

	if (ref.isNull(activeWindowHandle)) {
		return undefined; // Failed to get active window handle
	}

	// // Get memory address of the window handle as the "window ID"
	// const windowId = ref.address(activeWindowHandle);
	// // Get the window text length in "characters" to create the buffer
	// const windowTextLength = user32.GetWindowTextLengthW(activeWindowHandle);
	// // Allocate a buffer large enough to hold the window text as "Unicode" (UTF-16) characters (using ref-wchar-napi)
	// // This assumes using the "Basic Multilingual Plane" of Unicode, only 2 characters per Unicode code point
	// // Include some extra bytes for possible null characters
	// const windowTextBuffer = Buffer.alloc((windowTextLength * 2) + 4);
	// Write the window text to the buffer (it returns the text size, but it's not used here)
	user32.GetWindowTextW(activeWindowHandle, windowTextBuffer, windowTextLength + 2);
	// Remove trailing null characters
	const windowTextBufferClean = ref.reinterpretUntilZeros(windowTextBuffer, wchar.size);
	// The text as a JavaScript string
	const windowTitle = wchar.toString(windowTextBufferClean);

	// Allocate a buffer to store the process ID
	const processIdBuffer = ref.alloc('uint32');
	// Write the process ID creating the window to the buffer (it returns the thread ID, but it's not used here)
	user32.GetWindowThreadProcessId(activeWindowHandle, processIdBuffer);
	// Get the process ID as a number from the buffer
	const processId = ref.get(processIdBuffer);
	// Get a "handle" of the process
	const processHandle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, processId);

	const processHandleURL = kernel32.OpenProcess(UIA_EditControlTypeId, false, processId);

	const omniboxHwndBuffer = Buffer.alloc(66000);

	const windowUrlBuffer = Buffer.alloc((windowTextLength * 2) + 4);

	const url = user32.FindWindowExA(activeWindowHandle,null,'EDIT',null)

	user32.GetWindowTextW(url, windowUrlBuffer, windowTextLength + 2);

	
	// Remove trailing null characters
	const windowUrlBufferClean = ref.reinterpretUntilZeros(windowUrlBuffer, wchar.size);
	// The text as a JavaScript string
	const windowUrl= wchar.toString(windowUrlBuffer);

	// const windowUrlBufferClean = ref.reinterpretUntilZeros(omniboxHwndBuffer, wchar.size);

	// const windowURL = wchar.toString(windowUrlBufferClean);

	console.log("url", url)

	console.log("windowUrl", windowUrl)

	console.log("processHandle", processHandle)
	console.log("processHandleURL", processHandleURL)

	if (ref.isNull(processHandle)) {
		return undefined; // Failed to get process handle
	}

	// Set the path length to more than the Windows extended-length MAX_PATH length
	const pathLengthBytes = 66000;
	// Path length in "characters"
	const pathLengthChars = Math.floor(pathLengthBytes / 2);
	// Allocate a buffer to store the path of the process
	const processFileNameBuffer = Buffer.alloc(pathLengthBytes);
	// Create a buffer containing the allocated size for the path, as a buffer as it must be writable
	const processFileNameSizeBuffer = ref.alloc('uint32', pathLengthChars);
	// Write process file path to buffer
	kernel32.QueryFullProcessImageNameW(processHandle, 0, processFileNameBuffer, processFileNameSizeBuffer);
	// Remove null characters from buffer
	const processFileNameBufferClean = ref.reinterpretUntilZeros(processFileNameBuffer, wchar.size);
	// Get process file path as a string
	const processPath = wchar.toString(processFileNameBufferClean);
	// Get process file name from path
	const processName = path.basename(processPath);

	// Get process memory counters
	const memoryCounters = new ProcessMemoryCounters();
	memoryCounters.cb = ProcessMemoryCounters.size;
	const getProcessMemoryInfoResult = psapi.GetProcessMemoryInfo(processHandle, memoryCounters.ref(), ProcessMemoryCounters.size);

	// Close the "handle" of the process
	kernel32.CloseHandle(processHandle);
	// Create a new instance of Rect, the struct required by the `GetWindowRect` method
	const bounds = new Rect();
	// Get the window bounds and save it into the `bounds` variable
	const getWindowRectResult = user32.GetWindowRect(activeWindowHandle, bounds.ref());

	if (getProcessMemoryInfoResult === 0) {
		return undefined; // Failed to get process memory
	}

	if (getWindowRectResult === 0) {
		return undefined; // Failed to get window rect
	}

	var dict = {
		platform: 'windows',
		title: windowTitle,
		id: windowId,
		owner: {
			name: processName,
			processId,
			path: processPath
		},
		bounds: {
			x: bounds.left,
			y: bounds.top,
			width: bounds.right - bounds.left,
			height: bounds.bottom - bounds.top
		},
		memoryUsage: memoryCounters.WorkingSetSize
	};


	// Application('Google Chrome').windows[0].activeTab.name()
	// Application('Google Chrome').windows[0].activeTab.url()
	// // "Chromium" Example:

	// const frontmost_app_name = Application('System Events').applicationProcesses.where({ frontmost: true }).name()[0]
	// const frontmost_app = Application(frontmost_app_name)

	// const chromium_variants = ['Google Chrome', 'Chromium', 'Opera', 'Vivaldi', 'Brave Browser', 'Microsoft Edge']
	// const webkit_variants = ['Safari', 'Webkit']

	// if (chromium_variants.some(app_name => frontmost_app_name.startsWith(app_name))) {
	// var current_tab_title = frontmost_app.windows[0].activeTab.name()
	// var current_tab_url = frontmost_app.windows[0].activeTab.url()
	// } else if (webkit_variants.some(app_name => frontmost_app_name.startsWith(app_name))) {
	// var current_tab_title = frontmost_app.documents[0].name()
	// var current_tab_url = frontmost_app.documents[0].url()
	// } else {
	// throw new Error('You need a supported browser as your frontmost app')
	// }

	// let url = current_tab_url + '\n' + current_tab_title

	// console.log("url", url)

	return dict

	/* eslint-enable new-cap */
}

module.exports = () => Promise.resolve(windows());
module.exports.sync = windows;
