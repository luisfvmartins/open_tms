declare module 'ipaddr.js' {
  export type Range =
    | 'unicast'
    | 'unspecified'
    | 'broadcast'
    | 'multicast'
    | 'linkLocal'
    | 'loopback'
    | 'carrierGradeNat'
    | 'private'
    | 'reserved'
    | 'uniqueLocal'
    | 'ipv4Mapped'
    | 'rfc6145'
    | 'rfc6052'
    | '6to4'
    | 'teredo';

  export interface IPv4Address {
    kind(): 'ipv4';
    range(): Range;
    match(cidr: [IPv4Address, number]): boolean;
    toIPv4MappedAddress(): IPv6Address;
    octets: number[];
    toString(): string;
  }

  export interface IPv6Address {
    kind(): 'ipv6';
    range(): Range;
    match(cidr: [IPv6Address, number]): boolean;
    isIPv4MappedAddress(): boolean;
    toIPv4Address(): IPv4Address;
    parts: number[];
    toString(): string;
  }

  export function isValid(ip: string): boolean;
  export function parse(ip: string): IPv4Address | IPv6Address;
  export function parseCIDR(cidr: string): [IPv4Address | IPv6Address, number];
  export function subnetMatch(address: IPv4Address | IPv6Address, rangeList: any, defaultName?: string): string;

  export const IPv4: {
    isValid(ip: string): boolean;
    parse(ip: string): IPv4Address;
    parseCIDR(cidr: string): [IPv4Address, number];
  };

  export const IPv6: {
    isValid(ip: string): boolean;
    parse(ip: string): IPv6Address;
    parseCIDR(cidr: string): [IPv6Address, number];
  };

  const ipaddr: {
    isValid: typeof isValid;
    parse: typeof parse;
    parseCIDR: typeof parseCIDR;
    subnetMatch: typeof subnetMatch;
    IPv4: typeof IPv4;
    IPv6: typeof IPv6;
  };

  export default ipaddr;
}
