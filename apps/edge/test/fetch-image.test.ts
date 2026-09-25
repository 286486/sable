import { expect, it } from "vitest";
import { refusedHost } from "../src/fetch-image.ts";

/** The hostname as the WHATWG URL parser leaves it, which is what the check sees. */
const host = (h: string) => new URL(`http://${h}/`).hostname;

it.each([
  "localhost",
  "LocalHost",
  "a.localhost",
  "localhost.",
  "127.0.0.1",
  "0x7f.1",
  "2130706433",
  "0.0.0.0",
  "10.0.0.1",
  "100.64.0.1",
  "169.254.169.254",
  "172.16.0.1",
  "172.31.255.255",
  "192.0.0.8",
  "192.168.1.1",
  "198.18.0.1",
  "224.0.0.1",
  "240.0.0.1",
  "255.255.255.255",
  "[::]",
  "[::1]",
  "[fe80::1]",
  "[fec0::1]",
  "[fd00::1]",
  "[fc00::1]",
  "[ff02::1]",
  "[::ffff:127.0.0.1]",
  "[::ffff:10.1.2.3]",
  "[64:ff9b::7f00:1]",
])("refuses %s", (h) => {
  expect(refusedHost(host(h))).toBe(true);
});

it.each([
  "example.com",
  "cdn.example.org",
  "localhost.example.com",
  "8.8.8.8",
  "172.32.0.1",
  "100.128.0.1",
  "[2606:4700::1111]",
  "[::ffff:8.8.8.8]",
  "[64:ff9b::808:808]",
])("allows %s", (h) => {
  expect(refusedHost(host(h))).toBe(false);
});
