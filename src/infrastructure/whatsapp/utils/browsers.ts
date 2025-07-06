import { platform, release } from "os"
import { BrowsersMap } from "../types"

const PLATFORM_MAP = {
    'aix': 'AIX',
    'darwin': 'Mac OS',
    'win32': 'Windows',
    'android': 'Android',
    'freebsd': 'FreeBSD',
    'openbsd': 'OpenBSD',
    'sunos': 'Solaris'
}

export const Browsers: BrowsersMap = {
    ubuntu: (browser) => ['WhatBot', browser, '1.0.0'],
    macOS: (browser) => ['Mac OS', browser, '14.4.1'],
    baileys: (browser) => ['Baileys', browser, '6.5.0'],
    windows: (browser) => ['Windows', browser, '10.0.22631'],
    /** The appropriate browser based on your OS & release */
    appropriate: (browser) => [ PLATFORM_MAP[platform() as keyof typeof PLATFORM_MAP] || 'Ubuntu', browser, release() ]
}