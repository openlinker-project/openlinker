/**
 * Shoper Attribute Planner
 *
 * Decides which attribute values one publish sends to Shoper, reading what it
 * needs from the shop: an attribute's options and group (`GET /attributes/:id`),
 * the attribute list for a parameter named only by its name (`GET /attributes`),
 * and which categories each group is bound to (`GET /attribute-groups`).
 *
 * Every read is memoised for the life of the planner (one per adapter instance),
 * as a PROMISE so concurrent publishes share one request. A failed read is
 * dropped from the memo so the next publish retries it instead of replaying the
 * failure. Reads happen BEFORE the product write, so a failure that propagates
 * leaves nothing behind and the job simply retries.
 *
 * Nothing a parameter carries fails the publish here: an attribute that cannot
 * be written is a warning naming it and why. See `shoper-product-attributes.mapper.ts`
 * for the value rules and the live-verified write semantics behind them.
 *
 * @module libs/integrations/shoper/src/infrastructure/adapters/product-publisher
 */
import type { OfferParameter } from '@openlinker/core/listings';

import { ShoperApiError } from '../../../domain/exceptions/shoper-api.error';
import type { ShoperAttribute, ShoperAttributeGroup } from '../../../domain/types/shoper-api.types';
import type { ShoperAttributeWritePlan } from '../../../domain/types/shoper-product-write.types';
import type { ShoperHttpClient } from '../../http/shoper-http-client';
import { fetchAllShoperRows } from '../../http/shoper-pagination';
import {
  describeShoperAttribute,
  findShoperAttributeGroup,
  findShoperAttributesByName,
  isShoperAttributeGroupBound,
  readShoperId,
  resolveShoperAttributeValue,
} from '../../mappers/shoper-product-attributes.mapper';

const ATTRIBUTES_PATH = '/attributes';
const ATTRIBUTE_GROUPS_PATH = '/attribute-groups';

/** One attribute a parameter points at, with the shop's own definition of it. */
interface ShoperAttributeCandidate {
  readonly attributeId: string;
  readonly attribute: ShoperAttribute;
}

export class ShoperAttributePlanner {
  private attributeList: Promise<ShoperAttribute[]> | null = null;
  private groupList: Promise<ShoperAttributeGroup[]> | null = null;
  /** `null` once Shoper has said the attribute does not exist. */
  private readonly attributeDetails = new Map<string, Promise<ShoperAttribute | null>>();

  constructor(private readonly client: ShoperHttpClient) {}

  /**
   * The flat `attributes` map for a product whose main category is `categoryId`,
   * and a warning for every parameter left out. `categoryId` is `null` when the
   * category is not known, in which case nothing is sent: Shoper would drop any
   * attribute the category does not carry, and that cannot be checked.
   */
  async plan(
    parameters: readonly OfferParameter[] | undefined,
    categoryId: number | null,
  ): Promise<ShoperAttributeWritePlan> {
    const attributes: Record<string, string> = {};
    const warnings: string[] = [];
    if (parameters === undefined || parameters.length === 0) {
      return { attributes, warnings };
    }
    if (categoryId === null) {
      warnings.push(
        "Product attributes were not sent: the product's Shoper category is not known, and Shoper " +
          'silently drops an attribute whose group is not bound to that category.',
      );
      return { attributes, warnings };
    }

    for (const param of parameters) {
      const pick = await this.pickAttribute(param, categoryId, warnings);
      if (pick === null) {
        continue;
      }
      const { attributeId, attribute, trustValueIds } = pick;
      const label = describeShoperAttribute(attribute, attributeId);
      if (attributes[attributeId] !== undefined) {
        warnings.push(`${label} was set by more than one parameter; only the first one was sent.`);
        continue;
      }
      const resolution = resolveShoperAttributeValue(param, attribute, attributeId, trustValueIds);
      if (!resolution.ok) {
        warnings.push(resolution.warning);
        continue;
      }
      attributes[attributeId] = resolution.value;
      if (resolution.warning !== undefined) {
        warnings.push(resolution.warning);
      }
    }
    return { attributes, warnings };
  }

  /**
   * The attribute `param` targets, provided Shoper would keep a value for it on
   * this category. A numeric `id` is the Shoper attribute id (the attribute
   * picker's linkage, the WooCommerce `#1835` precedent); any other `id` is an
   * attribute NAME, matched ignoring case and surrounding whitespace.
   */
  private async pickAttribute(
    param: OfferParameter,
    categoryId: number,
    warnings: string[],
  ): Promise<(ShoperAttributeCandidate & { readonly trustValueIds: boolean }) | null> {
    const attributeId = readShoperId(param.id);
    if (attributeId !== null) {
      const attribute = await this.attributeDetail(attributeId);
      if (attribute === null) {
        warnings.push(`Attribute ${attributeId} does not exist in the Shoper shop; its value was not sent.`);
        return null;
      }
      const candidate = { attributeId, attribute };
      if (!(await this.isBound(candidate, categoryId))) {
        warnings.push(this.unboundWarning(candidate, categoryId));
        return null;
      }
      return { ...candidate, trustValueIds: true };
    }

    const name = param.id.trim();
    const matches = findShoperAttributesByName(await this.listAttributes(), name);
    if (matches.length === 0) {
      warnings.push(`No Shoper attribute is named "${name}"; its value was not sent.`);
      return null;
    }

    const candidates: ShoperAttributeCandidate[] = [];
    for (const match of matches) {
      const id = readShoperId(match.attribute_id);
      const detail = id === null ? null : await this.attributeDetail(id);
      if (id !== null && detail !== null) {
        candidates.push({ attributeId: id, attribute: detail });
      }
    }
    // Two groups may each carry an attribute of the same name; the category
    // decides, because only a bound one is stored.
    const bound: ShoperAttributeCandidate[] = [];
    for (const candidate of candidates) {
      if (await this.isBound(candidate, categoryId)) {
        bound.push(candidate);
      }
    }
    if (bound.length === 1 && bound[0] !== undefined) {
      return { ...bound[0], trustValueIds: false };
    }
    if (bound.length > 1) {
      warnings.push(
        `More than one Shoper attribute named "${name}" applies to category ${categoryId} ` +
          `(attributes ${bound.map((c) => c.attributeId).join(', ')}); its value was not sent. ` +
          'Pick the attribute by id instead.',
      );
      return null;
    }
    const first = candidates[0];
    warnings.push(
      first === undefined
        ? `The Shoper attribute named "${name}" could not be read from the shop; its value was not sent.`
        : this.unboundWarning(first, categoryId),
    );
    return null;
  }

  private async isBound(candidate: ShoperAttributeCandidate, categoryId: number): Promise<boolean> {
    const group = findShoperAttributeGroup(await this.listGroups(), candidate.attribute);
    return isShoperAttributeGroupBound(group, categoryId);
  }

  private unboundWarning(candidate: ShoperAttributeCandidate, categoryId: number): string {
    const groupId = readShoperId(candidate.attribute.attribute_group_id);
    return (
      `${describeShoperAttribute(candidate.attribute, candidate.attributeId)} was not sent: ` +
      `its attribute group${groupId === null ? '' : ` ${groupId}`} is not bound to category ${categoryId}, ` +
      'and Shoper silently drops such a value. Bind the group to the category in Shoper and publish again.'
    );
  }

  private listAttributes(): Promise<ShoperAttribute[]> {
    if (this.attributeList === null) {
      this.attributeList = fetchAllShoperRows<ShoperAttribute>(this.client, ATTRIBUTES_PATH, {
        order: 'attribute_id ASC',
      }).catch((error: unknown) => {
        this.attributeList = null;
        throw error;
      });
    }
    return this.attributeList;
  }

  private listGroups(): Promise<ShoperAttributeGroup[]> {
    if (this.groupList === null) {
      this.groupList = fetchAllShoperRows<ShoperAttributeGroup>(this.client, ATTRIBUTE_GROUPS_PATH, {
        order: 'attribute_group_id ASC',
      }).catch((error: unknown) => {
        this.groupList = null;
        throw error;
      });
    }
    return this.groupList;
  }

  /**
   * One attribute with its options. Shoper's own "no such resource" answer is
   * remembered as `null`; any other failure propagates and is not remembered.
   */
  private attributeDetail(attributeId: string): Promise<ShoperAttribute | null> {
    const memo = this.attributeDetails.get(attributeId);
    if (memo !== undefined) {
      return memo;
    }
    const read = this.client
      .get<ShoperAttribute | null>(`${ATTRIBUTES_PATH}/${encodeURIComponent(attributeId)}`)
      .then(({ data }) => data ?? null)
      .catch((error: unknown) => {
        if (error instanceof ShoperApiError && error.isResourceNotFound()) {
          return null;
        }
        this.attributeDetails.delete(attributeId);
        throw error;
      });
    this.attributeDetails.set(attributeId, read);
    return read;
  }
}
